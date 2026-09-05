/**
 * Paints the retained display list.
 *
 * The list is kept rather than drawn-and-forgotten so that a resize can repaint
 * without loss, a picture can be exported, and the batch tier can replay a
 * drawing with delays after the program has already finished.
 *
 * Turtle coordinates put the origin at the centre with y increasing upwards,
 * which is the opposite of the canvas convention; the transform is applied once
 * here rather than in every op.
 */
import type { DrawOp } from '../types.ts';

export class DisplayList {
  #ops: DrawOp[] = [];
  #canvas: HTMLCanvasElement;
  #frame: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
  }

  get length(): number { return this.#ops.length; }

  add(ops: readonly DrawOp[]): void {
    for (const op of ops) {
      if (op.op === 'clear') this.#ops = [];
      else this.#ops.push(op);
    }
    this.schedule();
  }

  clear(): void { this.#ops = []; this.schedule(); }

  /** Coalesce repaints to one per animation frame. */
  schedule(): void {
    if (this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => { this.#frame = null; this.paint(); });
  }

  paint(): void {
    const canvas = this.#canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = globalThis.devicePixelRatio || 1;
    const width = canvas.clientWidth || 480;
    const height = canvas.clientHeight || 360;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Background first: a `bg` op anywhere in the list applies to the whole
    // picture, exactly as turtle's bgcolor() does.
    const bg = [...this.#ops].reverse().find((o) => o.op === 'bg');
    if (bg && bg.op === 'bg') { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, width, height); }

    ctx.translate(width / 2, height / 2);
    ctx.scale(1, -1);                       // turtle's y grows upwards
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const op of this.#ops) {
      switch (op.op) {
        case 'line':
          ctx.beginPath();
          ctx.strokeStyle = op.color;
          ctx.lineWidth = op.width;
          ctx.moveTo(op.x1, op.y1);
          ctx.lineTo(op.x2, op.y2);
          ctx.stroke();
          break;
        case 'poly': {
          if (op.points.length < 6) break;
          ctx.beginPath();
          ctx.fillStyle = op.fill;
          ctx.moveTo(op.points[0] as number, op.points[1] as number);
          for (let i = 2; i < op.points.length; i += 2) {
            ctx.lineTo(op.points[i] as number, op.points[i + 1] as number);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'dot':
          ctx.beginPath();
          ctx.fillStyle = op.color;
          ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'text':
          ctx.save();
          ctx.scale(1, -1);                 // text must not be drawn mirrored
          ctx.fillStyle = op.color;
          ctx.font = op.font;
          ctx.fillText(op.text, op.x, -op.y);
          ctx.restore();
          break;
        default:
          break;
      }
    }
    ctx.restore();
  }

  toDataUrl(): string { this.paint(); return this.#canvas.toDataURL('image/png'); }
}
