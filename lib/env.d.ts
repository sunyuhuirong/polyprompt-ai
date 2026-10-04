/** 宿主环境声明：DSH client 半的 window.__ModuleLoader__ */
declare global {
  interface Window {
    __ModuleLoader__: {
      load: (def: {
        id: string
        factory: (require: (id: string) => any) => { inject: string[]; apply: (ctx: any) => void }
      }) => void
    }
  }
}
export {}
