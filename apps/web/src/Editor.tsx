/**
 * CodeMirror 6, chosen over Monaco because it is roughly a fifth of the bytes
 * and this runs on school Chromebooks.
 */
import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';

export function Editor({ value, onChange, onRun }: {
  value: string;
  onChange: (next: string) => void;
  onRun: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onRunRef = useRef(onRun);
  // Kept in a ref, and updated in an effect rather than during render, so the
  // keymap below closes over a stable function while still calling the latest
  // handler. Writing a ref during render is a correctness hazard.
  useEffect(() => { onRunRef.current = onRun; }, [onRun]);

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        python(),
        keymap.of([
          // Ctrl/Cmd-Enter runs. Students find it quickly and it saves a trip
          // to the mouse in the middle of an edit-run-edit loop.
          { key: 'Mod-Enter', preventDefault: true, run: () => { onRunRef.current(); return true; } },
          indentWithTab, ...defaultKeymap, ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.6' },
          '&.cm-focused': { outline: 'none' },
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // Mounted once, deliberately: CodeMirror owns the document from here, and
    // re-creating the view on every keystroke would lose the cursor. `value` is
    // therefore the initial document only, not a controlled prop, and both it
    // and onChange are read through closures that never need to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="editor" ref={host} />;
}
