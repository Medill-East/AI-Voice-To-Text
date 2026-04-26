declare module 'unbzip2-stream' {
  import type { Transform } from 'node:stream';

  export default function unbzip2Stream(): Transform;
}
