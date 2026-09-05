/**
 * The transcript, the input prompt and the progress line — shared by the
 * editor, the share page and the embed, so the three cannot drift.
 *
 * The prompt is a keydown handler, not a form: the embed runs inside a
 * sandboxed iframe without allow-forms, which blocks form submission before
 * any handler runs. Widening the sandbox to suit the interface would be the
 * wrong way round.
 */
import { useState } from 'react';
import type { RunnerHook } from './use-runner.ts';

export function Console({ runner, hidden = false }: { runner: RunnerHook; hidden?: boolean }) {
  const [answer, setAnswer] = useState('');

  return (
    <div className="console" hidden={hidden}>
      <pre>
        {runner.lines.map((line, i) => <span key={i} className={line.kind}>{line.text}</span>)}
      </pre>
      {runner.pendingInput && (
        <div className="ask">
          <span>{runner.pendingInput.prompt || '›'}</span>
          <input
            autoFocus
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              runner.answer(answer);
              setAnswer('');
            }}
            aria-label="Program input"
          />
        </div>
      )}
      {runner.progress && <div className="progress">{runner.progress}</div>}
    </div>
  );
}
