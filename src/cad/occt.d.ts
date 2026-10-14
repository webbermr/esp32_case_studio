declare module 'occt-import-js' {
  const occtimportjs: (opts?: { locateFile?: (path: string) => string }) => Promise<{
    ReadStepFile: (data: Uint8Array, params: unknown) => import('./step').OcctResult;
  }>;
  export default occtimportjs;
}
