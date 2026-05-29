import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import { fileToBase64, getFileParentPath } from '@/lib/file-utils'
import {
  agentStreamingStatesAtom,
  agentSessionStreamingStateAtomFamily,
  agentStreamErrorsAtom,
  agentPendingFilesAtomFamily,
  agentPendingPromptAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentChannelIdsAtom,
  agentThinkingAtom,
  agentWorkspacesAtom,
  agentSessionsAtom,
  agentSessionDraftsAtom,
  agentSessionDraftAtomFamily,
  agentSessionDraftHtmlAtom,
  agentSessionDraftHtmlAtomFamily,
  agentPromptSuggestionsAtom,
  liveMessagesMapAtom,
  stoppedByUserSessionsAtom,
  agentPermissionModeMapAtom,
  agentDefaultPermissionModeAtom,
  sessionPersistedPermissionModeAtom,
} from '@/atoms/agent-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { quotedSelectionMapAtom } from '@/atoms/preview-atoms'
import { channelsAtom } from '@/atoms/chat-atoms'
import type { AgentSendInput, SDKMessage, AgentPendingFile } from '@proma/shared'

export interface AgentSendResult {
  send: () => Promise<void>
  canSend: boolean
  hasAvailableModel: boolean
  hasTextInput: boolean
  inputContent: string
  setInputContent: (value: string) => void
  inputHtmlContent: string
  setInputHtmlContent: (html: string) => void
  suggestion: string | null
  agentChannelId: string | null
  hasChannelWarning: boolean
}

export function useAgentSend(
  sessionId: string,
  deps: {
    attachedDirs: string[]
    attachedFileDirectories: string[]
    pendingFiles: AgentPendingFile[]
    setPendingFiles: (updater: (prev: AgentPendingFile[]) => AgentPendingFile[]) => void
    pendingFilesRef: React.MutableRefObject<AgentPendingFile[]>
    streaming: boolean
    currentWorkspaceId: string | null
    permissionMode: string | undefined
  },
): AgentSendResult {
  const store = useStore()
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const streamState = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
  const setAgentStreamErrors = useSetAtom(agentStreamErrorsAtom)
  const [pendingPrompt, setPendingPrompt] = useAtom(agentPendingPromptAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const agentChannelIds = useAtomValue(agentChannelIdsAtom)
  const setAgentChannelIds = useSetAtom(agentChannelIdsAtom)
  const currentWorkspaceId = deps.currentWorkspaceId
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const agentThinking = useAtomValue(agentThinkingAtom)
  const globalChannels = useAtomValue(channelsAtom)
  const setPromptSuggestions = useSetAtom(agentPromptSuggestionsAtom)

  // 渠道已选但模型未选时，自动选择第一个可用模型
  const hasAvailableModel = React.useMemo(() => {
    const promaOfficial = globalChannels.find((c) => c.id === 'proma-official')
    if (promaOfficial?.enabled && promaOfficial.models.some((m) => m.enabled)) return true
    if (!agentChannelIds || agentChannelIds.length === 0) return false
    return globalChannels.some(
      (c) => c.enabled && agentChannelIds.includes(c.id) && c.models.some((m) => m.enabled),
    )
  }, [globalChannels, agentChannelIds])

  // 输入框内容 - 按 sessionId 切片订阅以优化重渲染
  const inputContent = useAtomValue(agentSessionDraftAtomFamily(sessionId))
  const setDraftsMap = useSetAtom(agentSessionDraftsAtom)
  const setInputContent = React.useCallback((value: string) => {
    setDraftsMap((prev) => {
      const map = new Map(prev)
      if (value.trim() === '') map.delete(sessionId)
      else map.set(sessionId, value)
      return map
    })
  }, [sessionId, setDraftsMap])

  const inputHtmlContent = useAtomValue(agentSessionDraftHtmlAtomFamily(sessionId))
  const setDraftHtmlMap = useSetAtom(agentSessionDraftHtmlAtom)
  const setInputHtmlContent = React.useCallback((html: string) => {
    setDraftHtmlMap((prev) => {
      const map = new Map(prev)
      if (!html || html === '<p></p>') map.delete(sessionId)
      else map.set(sessionId, html)
      return map
    })
  }, [sessionId, setDraftHtmlMap])

  const suggestionsMap = useAtomValue(agentPromptSuggestionsAtom)
  const suggestion = suggestionsMap.get(sessionId) ?? null

  const permissionModeMap = useAtomValue(agentPermissionModeMapAtom)
  const defaultPermissionMode = useAtomValue(agentDefaultPermissionModeAtom)
  const persistedPermissionMode = useAtomValue(sessionPersistedPermissionModeAtom(sessionId))
  const permissionMode = permissionModeMap.get(sessionId) ?? persistedPermissionMode ?? defaultPermissionMode

  const hasTextInput = inputContent.trim().length > 0
  const canSend = (hasTextInput || deps.pendingFiles.length > 0 || !!suggestion) && agentChannelId !== null && hasAvailableModel && (!deps.streaming || hasTextInput)
  const hasChannelWarning = !agentChannelId || !hasAvailableModel

  const getUserTextFromSDKMessage = React.useCallback((message: SDKMessage): string | null => {
    const sdkMessage = message as unknown as {
      type?: string; parent_tool_use_id?: string | null; isSynthetic?: boolean
      message?: { content?: unknown }
    }
    if (sdkMessage.type !== 'user' || sdkMessage.parent_tool_use_id || sdkMessage.isSynthetic) return null
    const content = sdkMessage.message?.content
    if (!Array.isArray(content)) return null
    if (content.some((block) => typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'tool_result')) return null
    const texts = content
      .filter((block) => typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'text' && typeof (block as Record<string, string>).text === 'string')
      .map((block) => (block as { text: string }).text)
    return texts.length > 0 ? texts.join('\n') : null
  }, [])

  const send = React.useCallback(async (): Promise<void> => {
    const text = inputContent.trim()
    const effectiveText = text || suggestion || ''
    const pendingFilesSnapshot = deps.pendingFilesRef.current
    if ((!effectiveText && pendingFilesSnapshot.length === 0) || !agentChannelId || !hasAvailableModel) return

    const additionalDirectoriesForRun = new Set(deps.attachedDirs)
    for (const dir of deps.attachedFileDirectories) {
      additionalDirectoriesForRun.add(dir)
    }

    // 流式追加
    if (deps.streaming) {
      if (pendingFilesSnapshot.length > 0) {
        toast.info('Agent 运行中暂不支持追加发送附件', {
          description: '请等待完成后再发送附件，或先撤除附件仅发送文本',
        })
        return
      }

      const localUuid = crypto.randomUUID()
      const syntheticMsg: SDKMessage = {
        type: 'user',
        uuid: localUuid,
        message: { content: [{ type: 'text', text: effectiveText }] },
        parent_tool_use_id: null,
        _createdAt: Date.now(),
      } as unknown as SDKMessage

      store.set(liveMessagesMapAtom, (prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        map.set(sessionId, [...current, syntheticMsg])
        return map
      })

      setInputContent('')
      setInputHtmlContent('')
      setPromptSuggestions((prev) => { const map = new Map(prev); map.delete(sessionId); return map })

      window.electronAPI.queueAgentMessage({
        sessionId,
        userMessage: effectiveText,
        uuid: localUuid,
        interrupt: true,
      }).catch((error) => {
        console.error('[AgentView] 追加消息失败:', error)
        toast.error('追加消息失败', { description: String(error) })
        store.set(liveMessagesMapAtom, (prev) => {
          const map = new Map(prev)
          const current = (map.get(sessionId) ?? []).filter(
            (m) => (m as unknown as { uuid?: string }).uuid !== localUuid,
          )
          map.set(sessionId, current)
          return map
        })
      })
      return
    }

    // 非流式发送（新对话）
    setAgentStreamErrors((prev) => { if (!prev.has(sessionId)) return prev; const map = new Map(prev); map.delete(sessionId); return map })
    setPromptSuggestions((prev) => { if (!prev.has(sessionId)) return prev; const map = new Map(prev); map.delete(sessionId); return map })

    let fileReferences = ''
    if (pendingFilesSnapshot.length > 0) {
      const workspace = workspaces.find((w) => w.id === currentWorkspaceId)
      if (!workspace) {
        toast.warning('暂时无法发送附件', {
          description: '当前 Agent 会话没有绑定有效工作区。请在顶部选择工作区，或新建 Agent 会话后重新上传。',
        })
        return
      }

      const existingFiles = pendingFilesSnapshot.filter((f) => f.sourcePath && !f.isClipboardDraft)
      const clipboardDrafts = pendingFilesSnapshot.filter((f) => f.sourcePath && f.isClipboardDraft)
      const newFiles = pendingFilesSnapshot.filter((f) => !f.sourcePath)
      const allRefs: Array<{ filename: string; targetPath: string }> = []

      for (const f of existingFiles) {
        const sourcePath = f.sourcePath!
        allRefs.push({ filename: f.filename, targetPath: sourcePath })
        const parentPath = getFileParentPath(sourcePath)
        if (parentPath) additionalDirectoriesForRun.add(parentPath)
      }

      const draftFilesToSave: Array<{ filename: string; data: string }> = []
      const staleDraftFiles: string[] = []
      for (const f of clipboardDrafts) {
        const sourcePath = f.sourcePath!
        const parentPath = getFileParentPath(sourcePath)
        try {
          const read = await window.electronAPI.resolveAndReadFile(sourcePath, {
            sessionId, candidateBasePaths: parentPath ? [parentPath] : undefined,
          })
          if (!read) { staleDraftFiles.push(f.filename); continue }
          const data = await fileToBase64(new File([read.content], f.filename, { type: f.mediaType }))
          draftFilesToSave.push({ filename: f.filename, data })
        } catch (error) {
          console.error('[AgentView] 读取剪贴板草稿失败:', error)
          staleDraftFiles.push(f.filename)
        }
      }
      if (staleDraftFiles.length > 0) {
        toast.error('附件数据已失效', { description: `请移除后重新粘贴：${staleDraftFiles.join('、')}` }); return
      }

      const inMemoryFilesToSave = newFiles.map((f) => ({
        filename: f.filename, data: window.__pendingAgentFileData?.get(f.id) || '',
      }))
      const missingDataFiles = inMemoryFilesToSave.filter((f) => !f.data).map((f) => f.filename)
      if (missingDataFiles.length > 0) {
        toast.error('附件数据已失效', { description: `请移除后重新添加文件：${missingDataFiles.join('、')}` }); return
      }

      const filesToSave = [...inMemoryFilesToSave, ...draftFilesToSave]
      if (filesToSave.length > 0) {
        try {
          const saved = await window.electronAPI.saveFilesToAgentSession({
            workspaceSlug: workspace.slug, sessionId, files: filesToSave,
          })
          allRefs.push(...saved)
        } catch (error) {
          console.error('[AgentView] 保存附件到 session 失败:', error)
          toast.error('附件保存失败', { description: '请确认当前工作区可用，或新建 Agent 会话后重新上传。' })
          return
        }
      }

      if (allRefs.length === 0) {
        toast.error('附件没有成功加入消息', { description: '请重新上传文件，或切换到有效工作区后再试。' }); return
      }

      fileReferences += `<attached_files>\n${allRefs.map((f) => `- ${f.filename}: ${f.targetPath}`).join('\n')}\n</attached_files>\n\n`

      for (const f of pendingFilesSnapshot) { if (f.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(f.previewUrl); window.__pendingAgentFileData?.delete(f.id) }
      deps.setPendingFiles(() => [])
    }

    const quotedSelection = store.get(quotedSelectionMapAtom).get(sessionId)
    if (quotedSelection) {
      const safePath = quotedSelection.filePath.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      const safeText = quotedSelection.text.replace(/<\/quoted_file>/gi, '</quoted_file_>')
      fileReferences += `<quoted_file path="${safePath}">\n${safeText}\n</quoted_file>\n\n`
      store.set(quotedSelectionMapAtom, (prev) => {
        const m = new Map(prev); const current = m.get(sessionId)
        if (current && current.capturedAt === quotedSelection.capturedAt) m.delete(sessionId); return m
      })
    }

    const finalMessage = fileReferences + effectiveText

    store.set(stoppedByUserSessionsAtom, (prev: Set<string>) => {
      if (!prev.has(sessionId)) return prev; const next = new Set(prev); next.delete(sessionId); return next
    })

    setDraftSessionIds((prev: Set<string>) => {
      if (!prev.has(sessionId)) return prev; const next = new Set(prev); next.delete(sessionId); return next
    })

    const streamStartedAt = Date.now()
    setStreamingStates((prev) => {
      const map = new Map(prev)
      const existing = prev.get(sessionId)
      map.set(sessionId, {
        running: true, content: '', toolActivities: [], model: agentModelId || undefined,
        startedAt: streamStartedAt, inputTokens: existing?.inputTokens, contextWindow: existing?.contextWindow,
      })
      return map
    })

    const SDKMessage: SDKMessage = {
      type: 'user', message: { content: [{ type: 'text', text: finalMessage }] },
      parent_tool_use_id: null, _createdAt: Date.now(),
    } as unknown as SDKMessage

    setInputContent('')
    setInputHtmlContent('')

    const input: AgentSendInput = {
      sessionId, userMessage: finalMessage, channelId: agentChannelId,
      modelId: agentModelId || undefined, workspaceId: currentWorkspaceId || undefined,
      startedAt: streamStartedAt, permissionModeOverride: permissionMode,
      ...(additionalDirectoriesForRun.size > 0 && { additionalDirectories: Array.from(additionalDirectoriesForRun) }),
      ...(() => {
        const skills = [...effectiveText.matchAll(/\/skill:(\S+)/g)].map(m => m[1]).filter(Boolean) as string[]
        const mcpIds = [...effectiveText.matchAll(/#mcp:(\S+)/g)].map(m => m[1]).filter(Boolean) as string[]
        const sessIds = [...effectiveText.matchAll(/&session:(\S+)/g)].map(m => m[1]).filter(Boolean) as string[]
        return { ...(skills.length > 0 && { mentionedSkills: skills }), ...(mcpIds.length > 0 && { mentionedMcpServers: mcpIds }), ...(sessIds.length > 0 && { mentionedSessionIds: sessIds }) }
      })(),
    }

    window.electronAPI.sendAgentMessage(input).catch((error) => {
      console.error('[AgentView] 发送消息失败:', error)
      setStreamingStates((prev) => { const current = prev.get(sessionId); if (!current) return prev; const map = new Map(prev); map.set(sessionId, { ...current, running: false }); return map })
    })
  }, [inputContent, deps.attachedDirs, deps.attachedFileDirectories, deps.pendingFilesRef, deps.streaming, deps.setPendingFiles,
      sessionId, agentChannelId, agentModelId, agentChannelIds, currentWorkspaceId, workspaces, sessions,
      suggestion, hasAvailableModel, store, setStreamingStates, setAgentStreamErrors, setPromptSuggestions,
      setInputContent, setInputHtmlContent, permissionMode, setDraftSessionIds])

  return {
    send, canSend, hasAvailableModel, hasTextInput, inputContent, setInputContent,
    inputHtmlContent, setInputHtmlContent, suggestion, agentChannelId, hasChannelWarning,
  }
}

