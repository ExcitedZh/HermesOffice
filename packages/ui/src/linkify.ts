/**
 * linkifyPaths — turns absolute file paths in agent responses into clickable
 * markdown links (they open in the app). Shared by the docs and pdf AI panels.
 */

const FILE_PATH_RE =
  /(?<![([])((?:\/Users\/|\/tmp\/|\/Volumes\/|file:\/\/)[^\s`'">\])]*?\.(?:docx|pdf|pptx|xlsx|doc|ppt|xls|md))/gi

export function linkifyPaths(text: string): string {
  return text.replace(FILE_PATH_RE, (m) => {
    const clean = m.replace(/^file:\/\//, '')
    const name = clean.split('/').pop() ?? clean
    return `[${name}](${clean})`
  })
}
