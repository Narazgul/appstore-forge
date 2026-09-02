import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { approveCommand, checkCommand, formatIssue, renderCommand } from './commands'
import { CliError } from './errors'

const USAGE = `forge <check|render|approve|dev> --project <dir> [--set default] [--target id]... [--locale id]... [--require-approval] [--by name]`

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  try {
    const { values } = parseArgs({
      args: rest,
      options: {
        project: { type: 'string' },
        set: { type: 'string', default: 'default' },
        target: { type: 'string', multiple: true },
        locale: { type: 'string', multiple: true },
        'require-approval': { type: 'boolean', default: false },
        by: { type: 'string' },
        port: { type: 'string', default: '4324' },
      },
    })
    if (!command || !values.project) {
      console.error(USAGE)
      return 1
    }
    const projectDir = resolve(values.project)
    const setId = values.set!
    switch (command) {
      case 'check': {
        const { issues, approvalOk } = await checkCommand({
          projectDir,
          setId,
          requireApproval: values['require-approval']!,
        })
        for (const i of issues) console.log(formatIssue(i))
        if (approvalOk !== null) console.log(approvalOk ? 'approval: ok' : 'approval: missing or stale')
        if (issues.some((i) => i.level === 'error')) return 2
        return approvalOk === false ? 3 : 0
      }
      case 'render': {
        const files = await renderCommand({
          projectDir,
          setId,
          targetIds: values.target,
          localeIds: values.locale,
          requireApproval: values['require-approval']!,
        })
        for (const f of files) console.log(f)
        console.log(`${files.length} files written`)
        return 0
      }
      case 'approve': {
        if (!values.by) throw new CliError('--by <name> is required', 1)
        const a = await approveCommand({ projectDir, setId, by: values.by })
        console.log(`approved by ${a.by} at ${a.at} (${a.hash.slice(0, 12)})`)
        return 0
      }
      case 'dev': {
        const { devCommand } = await import('./dev')
        await devCommand({ projectDir, setId, port: Number(values.port) })
        return 0
      }
      default:
        console.error(USAGE)
        return 1
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    // A bad flag is a usage mistake, not a project problem — say what the tool expects.
    if (isUsageError(err)) {
      console.error(USAGE)
      return 1
    }
    return err instanceof CliError ? err.exitCode : 1
  }
}

const isUsageError = (err: unknown): boolean =>
  typeof (err as NodeJS.ErrnoException)?.code === 'string' &&
  (err as NodeJS.ErrnoException).code!.startsWith('ERR_PARSE_ARGS')
