export const ERROR_VALUE_RE = /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!)$/
/** Total cells (by scanned extent) one find_cells / scan call may cover. */
export const MAX_SCAN_CELLS = 400_000
/** Row batches sized to stay under the sidecar's per-read cell budget. */
export const FILE_READ_BATCH_CELLS = 18_000
