import mysql from 'mysql2/promise'
import {
  NIS_MYSQL_DB,
  NIS_MYSQL_HOST,
  NIS_MYSQL_PASSWORD,
  NIS_MYSQL_PORT,
  NIS_MYSQL_USER,
  DBAIS5_MYSQL_DB,
  DBAIS5_MYSQL_HOST,
  DBAIS5_MYSQL_PASSWORD,
  DBAIS5_MYSQL_PORT,
  DBAIS5_MYSQL_USER,
  ZBX_MYSQL_DB,
  ZBX_MYSQL_HOST,
  ZBX_MYSQL_PASSWORD,
  ZBX_MYSQL_PORT,
  ZBX_MYSQL_USER,
} from './config'

export const pool = mysql.createPool({
  host: NIS_MYSQL_HOST,
  port: Number(NIS_MYSQL_PORT),
  user: NIS_MYSQL_USER,
  password: NIS_MYSQL_PASSWORD,
  database: NIS_MYSQL_DB,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})

export const dbaIs5 = mysql.createPool({
  host: DBAIS5_MYSQL_HOST,
  port: Number(DBAIS5_MYSQL_PORT),
  user: DBAIS5_MYSQL_USER,
  password: DBAIS5_MYSQL_PASSWORD,
  database: DBAIS5_MYSQL_DB,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})

export const zabbixMysqlPool = mysql.createPool({
  host: ZBX_MYSQL_HOST,
  port: Number(ZBX_MYSQL_PORT),
  user: ZBX_MYSQL_USER,
  password: ZBX_MYSQL_PASSWORD,
  database: ZBX_MYSQL_DB,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})