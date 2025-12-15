import { pool as mysqlDb } from '../nis.mysql'
import axios from 'axios'
import {
  GRACEPERIOD_HELPDESK,
  GRACEPERIOD_ENGINEER,
  SYNC_T2T_API_URL,
  SYNC_T2T_API_KEY,
} from '../config'
import { sendWhatsAppFeedbackScore, saveFeedbackSendInfo } from '../nusawa'
import { processSyncT2T } from '../syncT2t'

const IGNORED_PERIOD = 86400

export async function autocloseAssignedTicket() {
  const REQUEST_TICKET = 1
  const INCIDENT_TICKET = 2
  const HELPDESK_DEPT = new Set(['01', '17', '29'])
  const ENGINEER_DEPT = new Set(['04', '34'])

  const [solvedTickets] = await mysqlDb.query(
    `
        SELECT tu.TtsId, tu.UpdatedTime, t.TtsTypeId, t.CustId, t.AssignedNo, t.VcId, cs.contactIdT2T
        FROM TtsUpdate tu
        LEFT JOIN Tts t ON tu.TtsId = t.TtsId
        LEFT JOIN Employee e ON t.EmpId = e.EmpId
        LEFT JOIN CustomerServices cs on cs.CustServId = t.CustServId
        LEFT JOIN Customer c ON cs.CustId = c.CustId
        WHERE t.TtsTypeId IN (?, ?)
        AND t.Status = 'Call'
        AND t.AssignedNo > 0
        AND c.BranchId = '020'
        ORDER BY tu.TtsId, tu.UpdatedTime DESC
        `,
    [REQUEST_TICKET, INCIDENT_TICKET],
  )

  const proceeded = new Set()
  const now = new Date()

  for (const ticket of solvedTickets as any[]) {
    const {
      TtsId,
      UpdatedTime,
      TtsTypeId,
      CustId,
      AssignedNo,
      VcId,
      contactIdT2T,
    } = ticket
    if (proceeded.has(TtsId)) continue
    proceeded.add(TtsId)
    let DeptId: string
    let JobTitle: string
    const [rows] = await mysqlDb.query(
      `
        SELECT e.EmpId, e.DeptId, jt.Title AS JobTitle
        FROM TtsPIC tp
        LEFT JOIN Employee e ON tp.EmpId = e.EmpId
        LEFT JOIN JobTitle jt ON e.JobTitle = jt.Id
        WHERE tp.TtsId = ? AND tp.AssignedNo = ?
        `,
      [TtsId, AssignedNo],
    )
    const picRows = rows as {
      EmpId: string
      DeptId: string
      JobTitle: string
    }[]

    if (picRows.length === 0) {
      const [rowsp] = await mysqlDb.query(
        `
          select e.DeptId, e.EmpId, e.DeptId, jt.Title AS JobTitle
          from TtsUpdate tu
          LEFT JOIN Employee  e ON tu.EmpId = e.EmpId
          LEFT JOIN JobTitle jt ON e.JobTitle = jt.Id
          where TtsId=?
          order by TtsUpdateId desc limit 1
          `,
        [TtsId],
      )
      const picRowp = rowsp as {
        EmpId: string
        DeptId: string
        JobTitle: string
      }[]
      DeptId = picRowp[0].DeptId
      JobTitle = picRowp[0].JobTitle
    } else {
      DeptId = picRows[0].DeptId
      JobTitle = picRows[0].JobTitle
    }

    let gracePeriod: number

    let resolver = ''

    if (HELPDESK_DEPT.has(DeptId)) {
      gracePeriod = GRACEPERIOD_HELPDESK
      resolver = 'helpdesk'
    } else if (ENGINEER_DEPT.has(DeptId)) {
      gracePeriod = GRACEPERIOD_ENGINEER
      resolver = 'engineer'
    } else {
      continue
    }

    const updatedTimePlusGrace = new Date(
      new Date(UpdatedTime).getTime() + gracePeriod * 1000,
    )
    if (updatedTimePlusGrace > now) {
      continue
    }
    // Insert into TtsUpdate
    const [insertResult] = await mysqlDb.query(
      `
      INSERT INTO TtsUpdate (
        TtsId, UpdatedTime, ActionStart, ActionBegin, ActionEnd, ActionStop, EmpId, Note, AssignedNo, Status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        TtsId,
        now,
        now,
        now,
        now,
        now,
        'SYSTEM',
        'closed by SYSTEM',
        AssignedNo,
        'Call',
      ],
    )
    const insertedUpdateId = (insertResult as any).insertId

    // Insert into TtsChange
    await mysqlDb.query(
      `
      INSERT INTO TtsChange (TtsUpdateId, field, OldValue, NewValue)
      VALUES (?, 'Status', 'Call', 'Closed'),
             (?, 'SolvedBy', '', ?)
      `,
      [insertedUpdateId, insertedUpdateId, resolver],
    )

    // Update into Tts
    await mysqlDb.query(
      `
      UPDATE Tts
      SET Visited = ?, Status = 'Closed', SolvedBy = ?
      WHERE TtsId = ?
      `,
      [resolver === 'engineer' ? 1 : 0, resolver, TtsId],
    )

    // Skip feedback sending for REQUEST ticket closed by helpdesk
    if (TtsTypeId === REQUEST_TICKET && resolver === 'helpdesk') {
      continue
    }

    // Fetch ContactNo
    const [contactResult] = (await mysqlDb.query(
      `
      SELECT ContactNo
      FROM TtsContact
      WHERE TtsId = ?
      LIMIT 1
      `,
      [TtsId],
    )) as any[]
    if (contactResult.length === 0) continue

    let destination = contactResult[0].ContactNo
    if (!destination) continue
    if (destination.startsWith('0')) {
      destination = '+62' + destination.substring(1)
    } else if (!destination.startsWith('+')) {
      destination = '+' + destination
    }

    try {
      sendWhatsAppFeedbackScore(destination, JobTitle)
      saveFeedbackSendInfo(
        destination,
        CustId,
        TtsId,
        insertedUpdateId,
        AssignedNo,
      )

      // Call Sync T2T
      if (VcId) {
        await processSyncT2T(TtsId, insertedUpdateId, contactIdT2T, {
          is: {
            apiKey: SYNC_T2T_API_KEY,
            syncT2TUrl: SYNC_T2T_API_URL,
          },
        })
      }
    } catch (err) {
      if (err instanceof Error) {
        console.error(
          `Failed sending WhatsApp feedback for ticket ${TtsId}`,
          err.message,
        )
      } else {
        console.error(
          `Failed sending WhatsApp feedback for ticket ${TtsId}`,
          err,
        )
      }
    }
  }
}

export async function autoCloseEskalasiTickets(): Promise<void> {
  const [rows] = await mysqlDb.query(
    `
    SELECT tu.TtsId, tu.UpdatedTime, t.CustServId, t.VcId, cs.contactIdT2T
    FROM TtsUpdate tu
    LEFT JOIN Tts t ON tu.TtsId = t.TtsId
    LEFT JOIN Employee e ON t.EmpId = e.EmpId
    LEFT JOIN CustomerServices cs on cs.CustServId = t.CustServId
    LEFT JOIN Customer c ON cs.CustId = c.CustId
    WHERE t.TtsTypeId = 10
      AND t.Status = 'Call'
      AND c.BranchId = '020'
    ORDER BY tu.TtsId, tu.UpdatedTime DESC
    `,
  )

  const now = new Date()
  const proceeded = new Set<number>()

  for (const row of rows as any[]) {
    const { TtsId, UpdatedTime, CustServId, VcId, contactIdT2T } = row
    if (proceeded.has(TtsId)) continue
    proceeded.add(TtsId)

    const updatedTime = new Date(UpdatedTime)
    if (updatedTime.getTime() + IGNORED_PERIOD * 1000 > now.getTime()) continue

    const [assignRow] = await mysqlDb.query(
      `SELECT AssignedNo FROM TtsPIC WHERE TtsId = ? ORDER BY AssignedNo DESC LIMIT 1`,
      [TtsId],
    )
    const assignedNo = (assignRow as any[])[0]?.AssignedNo ?? 0

    const action = CustServId > 0 ? '' : 'tidak jadi pasang'

    // Insert into TtsUpdate
    const [insertRes] = await mysqlDb.query(
      `
      INSERT INTO TtsUpdate (
        TtsId, UpdatedTime, ActionStart, ActionBegin, ActionEnd, ActionStop, EmpId, Action, Note, AssignedNo, Status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Call')
      `,
      [
        TtsId,
        updatedTime,
        updatedTime,
        updatedTime,
        updatedTime,
        updatedTime,
        'SYSTEM',
        action,
        'closed by SYSTEM',
        assignedNo,
      ],
    )
    const updateId = (insertRes as any).insertId

    // Insert into TtsChange
    await mysqlDb.query(
      `INSERT INTO TtsChange (TtsUpdateId, field, OldValue, NewValue) VALUES (?, 'Status', 'Call', 'Closed')`,
      [updateId],
    )

    // Update Tts
    await mysqlDb.query(
      `UPDATE Tts SET Visited = 1, Status = 'Closed', SolvedBy = '' WHERE TtsId = ?`,
      [TtsId],
    )

    // Call Sync T2T
    if (VcId) {
      await processSyncT2T(TtsId, updateId, contactIdT2T, {
        is: {
          apiKey: SYNC_T2T_API_KEY,
          syncT2TUrl: SYNC_T2T_API_URL,
        },
      })
    }
  }
}

export async function autocloseHelpdeskTicket(): Promise<void> {
  const REQUEST_TICKET = 1
  const INCIDENT_TICKET = 2
  const [solvedTickets] = await mysqlDb.query(
    `
    SELECT tu.TtsId, tu.UpdatedTime, t.TtsTypeId, t.CustId, t.AssignedNo, t.VcId, cs.contactIdT2T, jt.Title
    FROM TtsUpdate tu
    LEFT JOIN Tts t ON tu.TtsId = t.TtsId
    LEFT JOIN Employee e ON t.EmpId = e.EmpId
    LEFT JOIN JobTitle jt ON e.JobTitle = jt.Id
    LEFT JOIN CustomerServices cs on cs.CustServId = t.CustServId
    LEFT JOIN Customer c ON cs.CustId = c.CustId
    WHERE t.TtsTypeId IN (?, ?)
      AND t.Status = 'Call'
      AND t.AssignedNo = 0
      AND c.BranchId = '020'
    ORDER BY tu.TtsId, tu.UpdatedTime DESC
    `,
    [REQUEST_TICKET, INCIDENT_TICKET],
  )

  const proceeded = new Set()
  const now = new Date()

  for (const ticket of solvedTickets as any[]) {
    const {
      TtsId,
      UpdatedTime,
      TtsTypeId,
      CustId,
      AssignedNo,
      VcId,
      contactIdT2T,
      Title,
    } = ticket
    if (proceeded.has(TtsId)) continue
    proceeded.add(TtsId)

    const updatedPlusIgnore = new Date(
      new Date(UpdatedTime).getTime() + GRACEPERIOD_HELPDESK * 1000,
    )
    if (updatedPlusIgnore > now) continue

    // Insert into TtsUpdate
    const [insertResult] = await mysqlDb.query(
      `
      INSERT INTO TtsUpdate (
        TtsId, UpdatedTime, ActionStart, ActionBegin, ActionEnd, ActionStop, EmpId, Note, AssignedNo, Status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [TtsId, now, now, now, now, now, 'SYSTEM', 'closed by SYSTEM', 0, 'Call'],
    )
    const insertedUpdateId = (insertResult as any).insertId

    // Insert into TtsChange
    await mysqlDb.query(
      `
      INSERT INTO TtsChange (TtsUpdateId, field, OldValue, NewValue)
      VALUES (?, 'Status', 'Call', 'Closed'),
             (?, 'SolvedBy', '', 'helpdesk')
      `,
      [insertedUpdateId, insertedUpdateId],
    )

    // Update into Tts
    await mysqlDb.query(
      `
      UPDATE Tts
      SET Visited = 0, Status = 'Closed', SolvedBy = 'helpdesk'
      WHERE TtsId = ?
      `,
      [TtsId],
    )

    // Skip feedback for REQUEST ticket
    if (TtsTypeId === REQUEST_TICKET) continue

    // Fetch contact number
    const [contactResult] = (await mysqlDb.query(
      `SELECT ContactNo FROM TtsContact WHERE TtsId = ? LIMIT 1`,
      [TtsId],
    )) as any[]
    if (contactResult.length === 0 || !contactResult[0].ContactNo) continue

    let destination = contactResult[0].ContactNo
    if (destination.startsWith('0')) {
      destination = '+62' + destination.substring(1)
    } else if (!destination.startsWith('+')) {
      destination = '+' + destination
    }

    try {
      sendWhatsAppFeedbackScore(destination, Title)
      saveFeedbackSendInfo(
        destination,
        CustId,
        TtsId,
        insertedUpdateId,
        AssignedNo,
      )

      // Call Sync T2T
      if (VcId) {
        await processSyncT2T(TtsId, insertedUpdateId, contactIdT2T, {
          is: {
            apiKey: SYNC_T2T_API_KEY,
            syncT2TUrl: SYNC_T2T_API_URL,
          },
        })
      }
    } catch (err) {
      if (err instanceof Error) {
        console.error(
          `Failed sending WhatsApp feedback for ticket ${TtsId}`,
          err.message,
        )
      } else {
        console.error(
          `Failed sending WhatsApp feedback for ticket ${TtsId}`,
          err,
        )
      }
    }
  }
}

export async function autoCloseNocTickets(): Promise<void> {
  const [rows] = await mysqlDb.query(
    `
    SELECT tu.TtsId, tu.UpdatedTime, t.CustServId, t.VcId, cs.contactIdT2T
    FROM TtsUpdate tu
    LEFT JOIN Tts t ON tu.TtsId = t.TtsId
    LEFT JOIN Employee e ON t.EmpId = e.EmpId
    LEFT JOIN CustomerServices cs on cs.CustServId = t.CustServId
    LEFT JOIN Customer c ON cs.CustId = c.CustId
    WHERE t.TtsTypeId = 7
      AND t.Status = 'Call'
      AND c.BranchId = '020'
    ORDER BY tu.TtsId, tu.UpdatedTime DESC
    `,
  )

  const now = new Date()
  const proceeded = new Set<number>()

  for (const row of rows as any[]) {
    const { TtsId, UpdatedTime, CustServId, VcId, contactIdT2T } = row
    if (proceeded.has(TtsId)) continue
    proceeded.add(TtsId)

    const updatedTime = new Date(UpdatedTime)
    if (updatedTime.getTime() + IGNORED_PERIOD * 1000 > now.getTime()) continue

    const [assignRow] = await mysqlDb.query(
      `SELECT AssignedNo FROM TtsPIC WHERE TtsId = ? ORDER BY AssignedNo DESC LIMIT 1`,
      [TtsId],
    )
    const assignedNo = (assignRow as any[])[0]?.AssignedNo ?? 0

    const action = CustServId > 0 ? '' : 'tidak jadi pasang'

    // Insert into TtsUpdate
    const [insertRes] = await mysqlDb.query(
      `
      INSERT INTO TtsUpdate (
        TtsId, UpdatedTime, ActionStart, ActionBegin, ActionEnd, ActionStop, EmpId, Action, Note, AssignedNo, Status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Call')
      `,
      [
        TtsId,
        updatedTime,
        updatedTime,
        updatedTime,
        updatedTime,
        updatedTime,
        'SYSTEM',
        action,
        'closed by SYSTEM',
        assignedNo,
      ],
    )
    const updateId = (insertRes as any).insertId

    // Insert into TtsChange
    await mysqlDb.query(
      `INSERT INTO TtsChange (TtsUpdateId, field, OldValue, NewValue) VALUES (?, 'Status', 'Call', 'Closed')`,
      [updateId],
    )

    // Update Tts
    await mysqlDb.query(
      `UPDATE Tts SET Visited = 1, Status = 'Closed', SolvedBy = '' WHERE TtsId = ?`,
      [TtsId],
    )

    // Call Sync T2T
    if (VcId) {
      await processSyncT2T(TtsId, updateId, contactIdT2T, {
        is: {
          apiKey: SYNC_T2T_API_KEY,
          syncT2TUrl: SYNC_T2T_API_URL,
        },
      })
    }
  }
}

export async function autoCloseSurveyTickets(): Promise<void> {
  const [rows] = await mysqlDb.query(
    `
    SELECT tu.TtsId, tu.UpdatedTime, t.CustServId, t.VcId, cs.contactIdT2T
    FROM TtsUpdate tu
    LEFT JOIN Tts t ON tu.TtsId = t.TtsId
    LEFT JOIN Employee e ON t.EmpId = e.EmpId
    LEFT JOIN CustomerServices cs on cs.CustServId = t.CustServId
    LEFT JOIN Customer c ON cs.CustId = c.CustId
    WHERE t.TtsTypeId = 5
      AND t.Status = 'Call'
      AND c.BranchId = '020'
    ORDER BY tu.TtsId, tu.UpdatedTime DESC
    `,
  )

  const now = new Date()
  const proceeded = new Set<number>()

  for (const row of rows as any[]) {
    const { TtsId, UpdatedTime, CustServId, VcId, contactIdT2T } = row
    if (proceeded.has(TtsId)) continue
    proceeded.add(TtsId)

    const updatedTime = new Date(UpdatedTime)
    if (updatedTime.getTime() + IGNORED_PERIOD * 1000 > now.getTime()) continue

    const [assignRow] = await mysqlDb.query(
      `SELECT AssignedNo FROM TtsPIC WHERE TtsId = ? ORDER BY AssignedNo DESC LIMIT 1`,
      [TtsId],
    )
    const assignedNo = (assignRow as any[])[0]?.AssignedNo ?? 0

    const action = CustServId > 0 ? '' : 'tidak jadi pasang'
    const successStatus = CustServId > 0 ? 1 : 0

    // Insert into TtsUpdate
    const [insertRes] = await mysqlDb.query(
      `
      INSERT INTO TtsUpdate (
        TtsId, UpdatedTime, ActionStart, ActionBegin, ActionEnd, ActionStop, EmpId, Action, Note, AssignedNo, Status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Call')
      `,
      [
        TtsId,
        updatedTime,
        updatedTime,
        updatedTime,
        updatedTime,
        updatedTime,
        'SYSTEM',
        action,
        'closed by SYSTEM',
        assignedNo,
      ],
    )
    const updateId = (insertRes as any).insertId

    // Insert into TtsChange
    await mysqlDb.query(
      `INSERT INTO TtsChange (TtsUpdateId, field, OldValue, NewValue) VALUES (?, 'Status', 'Call', 'Closed')`,
      [updateId],
    )

    // Update Tts
    await mysqlDb.query(
      `UPDATE Tts SET Visited = 1, Status = 'Closed', SolvedBy = '' WHERE TtsId = ?`,
      [TtsId],
    )

    // Update TtsSurvey
    await mysqlDb.query(`UPDATE TtsSurvey SET IsSuccess = ? WHERE TtsId = ?`, [
      successStatus,
      TtsId,
    ])

    // Call Sync T2T
    if (VcId) {
      await processSyncT2T(TtsId, updateId, contactIdT2T, {
        is: {
          apiKey: SYNC_T2T_API_KEY,
          syncT2TUrl: SYNC_T2T_API_URL,
        },
      })
    }
  }
}

export async function autoCloseMonitoringTickets(): Promise<void> {
  const [rows] = await mysqlDb.query(
    `
    SELECT tu.TtsId, tu.UpdatedTime, t.CustServId, t.VcId, cs.contactIdT2T
    FROM TtsUpdate tu
    LEFT JOIN Tts t ON tu.TtsId = t.TtsId
    LEFT JOIN Employee e ON t.EmpId = e.EmpId
    LEFT JOIN CustomerServices cs on cs.CustServId = t.CustServId
    LEFT JOIN Customer c ON cs.CustId = c.CustId
    WHERE t.TtsTypeId = 6
      AND t.Status = 'Call'
      AND c.BranchId = '020'
    ORDER BY tu.TtsId, tu.UpdatedTime DESC
    `,
  )

  const now = new Date()
  const proceeded = new Set<number>()

  for (const row of rows as any[]) {
    const { TtsId, UpdatedTime, CustServId, VcId, contactIdT2T } = row
    if (proceeded.has(TtsId)) continue
    proceeded.add(TtsId)

    const updatedTime = new Date(UpdatedTime)
    if (updatedTime.getTime() + IGNORED_PERIOD * 1000 > now.getTime()) continue

    const [assignRow] = await mysqlDb.query(
      `SELECT AssignedNo FROM TtsPIC WHERE TtsId = ? ORDER BY AssignedNo DESC LIMIT 1`,
      [TtsId],
    )
    const assignedNo = (assignRow as any[])[0]?.AssignedNo ?? 0

    const action = CustServId > 0 ? '' : 'tidak jadi pasang'

    // Insert into TtsUpdate
    const [insertRes] = await mysqlDb.query(
      `
      INSERT INTO TtsUpdate (
        TtsId, UpdatedTime, ActionStart, ActionBegin, ActionEnd, ActionStop, EmpId, Action, Note, AssignedNo, Status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Call')
      `,
      [
        TtsId,
        updatedTime,
        updatedTime,
        updatedTime,
        updatedTime,
        updatedTime,
        'SYSTEM',
        action,
        'closed by SYSTEM',
        assignedNo,
      ],
    )
    const updateId = (insertRes as any).insertId

    // Insert into TtsChange
    await mysqlDb.query(
      `INSERT INTO TtsChange (TtsUpdateId, field, OldValue, NewValue) VALUES (?, 'Status', 'Call', 'Closed')`,
      [updateId],
    )

    // Update Tts
    await mysqlDb.query(
      `UPDATE Tts SET Visited = 1, Status = 'Closed', SolvedBy = '' WHERE TtsId = ?`,
      [TtsId],
    )

    // Call Sync T2T
    if (VcId) {
      await processSyncT2T(TtsId, updateId, contactIdT2T, {
        is: {
          apiKey: SYNC_T2T_API_KEY,
          syncT2TUrl: SYNC_T2T_API_URL,
        },
      })
    }
  }
}
