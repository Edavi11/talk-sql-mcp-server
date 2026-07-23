import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const CONN = {
  postgresql: process.env.TALK_SQL_TEST_PG ?? "postgresql://talksql:talksql_test_pw@localhost:55432/talksql_test",
  mysql: process.env.TALK_SQL_TEST_MYSQL ?? "mysql://talksql:talksql_test_pw@localhost:53306/talksql_test",
  mssql: process.env.TALK_SQL_TEST_MSSQL ?? "mssql://sa:TalkSql_Test_Pw1@localhost:51433/master?encrypt=false&trustServerCertificate=true",
  db2: process.env.TALK_SQL_TEST_DB2 ?? "db2://db2inst1:talksql_test_pw@localhost:50000/TALKSQL",
};

export function newSqliteConnectionString(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "talk-sql-test-"));
  return path.join(dir, "test.db");
}

export function uniqueTableName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}
