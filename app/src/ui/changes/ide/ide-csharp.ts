import { invokeProxy, sendProxy } from '../../main-process-proxy'

export const highlightCSharp = invokeProxy('csharp-highlight', 2)
export const navigateCSharp = invokeProxy('csharp-navigate', 3)
export const updateCSharpDocument = sendProxy('csharp-update', 1)
export const closeCSharpWorkspace = sendProxy('csharp-close', 1)
