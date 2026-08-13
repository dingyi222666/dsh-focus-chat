/**
 * Test-side stand-in for `@deepseek-ai/dsh-client-runtime/client`: the npm
 * package's /client entry is a browser-shell bundle, so vitest aliases the
 * specifier here; the bundled values arrive through the loader shim.
 */
import './loader-shim.ts'
import { modules } from './loader-shim.ts'
// The bundled closure: evaluated here so the loader shim captures its exports
// (the package's exports map hides the lib path, so the import is relative).
import '../../node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js'

const runtime = modules.get('@deepseek-ai/dsh-client-runtime')
if (runtime === undefined) {
  throw new Error('test runtime shim: the runtime bundle never loaded')
}

export const apply = runtime.apply as typeof import('@deepseek-ai/dsh-client-runtime/client')['apply']
export const contextForm = runtime.contextForm as typeof import('@deepseek-ai/dsh-client-runtime/client')['contextForm']
export const contextProvenance = runtime.contextProvenance as typeof import('@deepseek-ai/dsh-client-runtime/client')['contextProvenance']
export const conversationContextKey = runtime.conversationContextKey as typeof import('@deepseek-ai/dsh-client-runtime/client')['conversationContextKey']
export const ConversationEventRegistry = runtime.ConversationEventRegistry as typeof import('@deepseek-ai/dsh-client-runtime/client')['ConversationEventRegistry']
export const ConversationLocationIndex = runtime.ConversationLocationIndex as typeof import('@deepseek-ai/dsh-client-runtime/client')['ConversationLocationIndex']
export const ConversationNodeAssembler = runtime.ConversationNodeAssembler as typeof import('@deepseek-ai/dsh-client-runtime/client')['ConversationNodeAssembler']
export const ConversationViewRegistry = runtime.ConversationViewRegistry as typeof import('@deepseek-ai/dsh-client-runtime/client')['ConversationViewRegistry']
export const createScope = runtime.createScope as typeof import('@deepseek-ai/dsh-client-runtime/client')['createScope']
export const createSnapshotStore = runtime.createSnapshotStore as typeof import('@deepseek-ai/dsh-client-runtime/client')['createSnapshotStore']
export const defineStore = runtime.defineStore as typeof import('@deepseek-ai/dsh-client-runtime/client')['defineStore']
export const DirectoryBrowseError = runtime.DirectoryBrowseError as typeof import('@deepseek-ai/dsh-client-runtime/client')['DirectoryBrowseError']
export const displayFailureMessage = runtime.displayFailureMessage as typeof import('@deepseek-ai/dsh-client-runtime/client')['displayFailureMessage']
export const EMPTY_CHAT_SNAPSHOT = runtime.EMPTY_CHAT_SNAPSHOT as typeof import('@deepseek-ai/dsh-client-runtime/client')['EMPTY_CHAT_SNAPSHOT']
export const emptyAssistantBlock = runtime.emptyAssistantBlock as typeof import('@deepseek-ai/dsh-client-runtime/client')['emptyAssistantBlock']
export const indexSubagentDescendants = runtime.indexSubagentDescendants as typeof import('@deepseek-ai/dsh-client-runtime/client')['indexSubagentDescendants']
export const inject = runtime.inject as typeof import('@deepseek-ai/dsh-client-runtime/client')['inject']
export const isAppendSurfaceEvent = runtime.isAppendSurfaceEvent as typeof import('@deepseek-ai/dsh-client-runtime/client')['isAppendSurfaceEvent']
export const isReplacementSurfaceEvent = runtime.isReplacementSurfaceEvent as typeof import('@deepseek-ai/dsh-client-runtime/client')['isReplacementSurfaceEvent']
export const isTokenDelta = runtime.isTokenDelta as typeof import('@deepseek-ai/dsh-client-runtime/client')['isTokenDelta']
export const PendingWait = runtime.PendingWait as typeof import('@deepseek-ai/dsh-client-runtime/client')['PendingWait']
export const resolveWorkspacePath = runtime.resolveWorkspacePath as typeof import('@deepseek-ai/dsh-client-runtime/client')['resolveWorkspacePath']
export const scopeOf = runtime.scopeOf as typeof import('@deepseek-ai/dsh-client-runtime/client')['scopeOf']
export const SessionCreateError = runtime.SessionCreateError as typeof import('@deepseek-ai/dsh-client-runtime/client')['SessionCreateError']
export const SessionProvideChannel = runtime.SessionProvideChannel as typeof import('@deepseek-ai/dsh-client-runtime/client')['SessionProvideChannel']
export const SessionRuntime = runtime.SessionRuntime as typeof import('@deepseek-ai/dsh-client-runtime/client')['SessionRuntime']
export const shallowEqual = runtime.shallowEqual as typeof import('@deepseek-ai/dsh-client-runtime/client')['shallowEqual']
export const SlotRegistry = runtime.SlotRegistry as typeof import('@deepseek-ai/dsh-client-runtime/client')['SlotRegistry']
export const toAssistantBlock = runtime.toAssistantBlock as typeof import('@deepseek-ai/dsh-client-runtime/client')['toAssistantBlock']
export const toAssistantBlocks = runtime.toAssistantBlocks as typeof import('@deepseek-ai/dsh-client-runtime/client')['toAssistantBlocks']
export const WorkspaceCreateError = runtime.WorkspaceCreateError as typeof import('@deepseek-ai/dsh-client-runtime/client')['WorkspaceCreateError']
export const WorkspaceRuntime = runtime.WorkspaceRuntime as typeof import('@deepseek-ai/dsh-client-runtime/client')['WorkspaceRuntime']
export const workspaceTitleOf = runtime.workspaceTitleOf as typeof import('@deepseek-ai/dsh-client-runtime/client')['workspaceTitleOf']
