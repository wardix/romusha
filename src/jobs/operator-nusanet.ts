import { pool as mysqlDb, dbaIs5 as mysqlDbaIs5 } from '../nis.mysql'

export async function syncDataCgsToDba() {
  const [dataOperatorCgs] = await mysqlDb.query(
    `
            SELECT
                cs.custServId,
                MAX(CASE WHEN cstc.attribute = 'ONU IP'     THEN cstc.value END) AS 'onuIp',
                MAX(CASE WHEN cstc.attribute = 'Vendor CID' THEN cstc.value END) AS 'vendorCid'
            FROM Customer c
            LEFT JOIN CustomerServices cs ON c.CustId = cs.CustId
            LEFT JOIN CustomerServiceTechnicalLink cstl ON cs.custServId = cstl.custServId
            LEFT JOIN CustomerServiceTechnicalCustom cstc ON cstc.technicalTypeId = cstl.id
                AND cstc.attribute REGEXP 'Vendor CID|ONU IP'
            WHERE c.BranchId = '020'
                AND cs.CustStatus <> 'NA'
                AND cstl.foVendorId = 2
            GROUP BY
                cs.custServId, cs.CustStatus, cstl.foVendorId, cstl.id
            ORDER BY cs.custServId
        `,
  )
  await mysqlDbaIs5.query('DELETE FROM cgs')
  for (const cgs of dataOperatorCgs as any[]) {
    let { custServId, onuIp, vendorCid } = cgs

    onuIp = onuIp && onuIp.trim() !== '' ? onuIp : null
    vendorCid = vendorCid && vendorCid.trim() !== '' ? vendorCid : null

    try {
      const [insRes] = await mysqlDbaIs5.query(
        `INSERT INTO cgs (service_id, onu_ip, operator_cid) VALUES (?, ?, ?)`,
        [custServId, onuIp, vendorCid],
      )
    } catch (err) {
      console.error('insert failed:', err)
    }
  }
}
