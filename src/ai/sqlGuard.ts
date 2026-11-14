/**
 * Guardrail for model-generated SQL. The browser database is disposable, but
 * an analyst tool should still never execute writes, file access or multiple
 * statements just because a model produced them.
 */
const BANNED_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|DROP|CREATE|ALTER|TRUNCATE|COPY|ATTACH|DETACH|INSTALL|LOAD|PRAGMA|SET|RESET|EXPORT|IMPORT|CALL|CHECKPOINT|VACUUM|GRANT|REVOKE|USE|BEGIN|COMMIT|ROLLBACK)\b/i;
const BANNED_FUNCTIONS = /\b(read_\w+|glob|parquet_scan|parquet_metadata|sniff_csv|httpfs\w*)\s*\(/i;

/** Removes comments and the contents of string literals / quoted identifiers. */
function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

export class SqlGuardError extends Error {}

/** Returns the cleaned, single read-only statement or throws SqlGuardError. */
export function guardSql(raw: string): string {
  let sql = raw.trim();
  // Models occasionally wrap SQL in markdown fences despite instructions.
  sql = sql.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
  sql = sql.replace(/;+\s*$/, '').trim();
  if (!sql) throw new SqlGuardError('The model returned an empty query.');

  const bare = stripLiteralsAndComments(sql);
  if (bare.includes(';')) throw new SqlGuardError('Only a single SQL statement is allowed.');
  const first = bare.trim().split(/[\s(]+/)[0]?.toUpperCase();
  if (!['SELECT', 'WITH', 'FROM'].includes(first ?? '')) {
    throw new SqlGuardError(`Only read-only SELECT queries are allowed (query starts with "${first}").`);
  }
  const kw = BANNED_KEYWORDS.exec(bare);
  if (kw) throw new SqlGuardError(`Blocked keyword "${kw[1].toUpperCase()}" — only read-only queries are allowed.`);
  const fn = BANNED_FUNCTIONS.exec(bare);
  if (fn) throw new SqlGuardError(`Blocked function "${fn[1]}" — file and network access is not allowed.`);
  return sql;
}
