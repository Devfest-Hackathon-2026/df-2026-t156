// Compatibility only: historical World/rules are not rewritten.
export const fileURLToPath = value => String(value);
const name = value => new URL(String(value), import.meta.url).pathname.split('/').pop();
export const existsSync = value => Object.hasOwn(globalThis.archiveFiles, name(value));
export function readFileSync(value) {
  const key=name(value);
  if (!Object.hasOwn(globalThis.archiveFiles,key)) throw new Error('Missing historical data: '+key);
  return globalThis.archiveFiles[key];
}
export function randomInt(min,max) {
  if (max===undefined) { max=min; min=0; }
  const range=max-min, limit=Math.floor(0x100000000/range)*range;
  if (!Number.isSafeInteger(range)||range<1) throw new RangeError('Invalid random range');
  const value=new Uint32Array(1);
  do { crypto.getRandomValues(value); } while(value[0]>=limit);
  return min+value[0]%range;
}
