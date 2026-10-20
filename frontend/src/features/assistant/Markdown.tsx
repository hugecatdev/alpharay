import { Fragment, type ReactNode } from 'react'
import styles from './Markdown.module.css'

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>
    return <Fragment key={index}>{part}</Fragment>
  })
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul'; items: string[] } | { kind: 'ol'; items: string[] } | { kind: 'h'; text: string }

function parse(source: string): Block[] {
  const blocks: Block[] = []
  for (const raw of source.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    const last = blocks[blocks.length - 1]
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const heading = /^#{1,4}\s+(.*)$/.exec(line)
    if (!line.trim()) {
      blocks.push({ kind: 'p', lines: [] })
    } else if (heading) {
      blocks.push({ kind: 'h', text: heading[1] })
    } else if (bullet) {
      if (last?.kind === 'ul') last.items.push(bullet[1])
      else blocks.push({ kind: 'ul', items: [bullet[1]] })
    } else if (ordered) {
      if (last?.kind === 'ol') last.items.push(ordered[1])
      else blocks.push({ kind: 'ol', items: [ordered[1]] })
    } else if (last?.kind === 'p') {
      last.lines.push(line)
    } else {
      blocks.push({ kind: 'p', lines: [line] })
    }
  }
  return blocks.filter((block) => block.kind !== 'p' || block.lines.length > 0)
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className={styles.markdown}>
      {parse(source).map((block, index) => {
        if (block.kind === 'h') return <h4 key={index}>{inline(block.text)}</h4>
        if (block.kind === 'ul' || block.kind === 'ol') {
          const List = block.kind
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item)}</li>
              ))}
            </List>
          )
        }
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
