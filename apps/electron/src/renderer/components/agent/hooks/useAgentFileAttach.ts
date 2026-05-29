import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  agentAttachedDirectoriesMapAtom,
  agentAttachedFilesMapAtom,
  agentPendingFilesAtomFamily,
  workspaceAttachedFilesMapAtom,
  workspaceAttachedDirectoriesMapAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  agentSessionsAtom,
} from '@/atoms/agent-atoms'
import { previewFileMapAtom } from '@/atoms/preview-atoms'
import { previewPanelOpenMapAtom } from '@/atoms/preview-atoms'
import type { AgentPendingFile, FileDialogLargeFile } from '@proma/shared'
import { MAX_ATTACHMENT_SIZE } from '@proma/shared'
import { fileToBase64, formatFileNames, getFileParentPath } from '@/lib/file-utils'
import { createClipboardPendingFile, createClipboardTextDraft, makeUniqueAttachmentName } from '@/lib/clipboard-text-attachment'

export interface AgentFileAttachResult {
  pendingFiles: AgentPendingFile[]
  setPendingFiles: ReturnType<typeof useSetAtom<ReturnType<typeof agentPendingFilesAtomFamily>>>
  attachedDirs: string[]
  attachedFiles: string[]
  wsAttachedDirs: string[]
  wsAttachedFiles: string[]
  hasAvailableModel: boolean
  workspaceDirs: string[]
  attachedFileDirectories: string[]
  workspaceMentionPaths: string[]
  sessionMentionPaths: string[]
  allAttachedDirs: string[]
  isDragOver: boolean
  pendingFilesRef: React.MutableRefObject<AgentPendingFile[]>
  attachFromDialog: () => Promise<void>
  attachFolder: () => Promise<void>
  removeFile: (id: string) => void
  handleDrop: (e: React.DragEvent) => Promise<void>
  handleDragOver: (e: React.DragEvent) => void
  handleDragLeave: (e: React.DragEvent) => void
  handlePasteFiles: (files: File[]) => void
  handlePasteLongText: (text: string) => void
  handleClipboardPreview: (file: AgentPendingFile) => Promise<void>
  addClipboardTextDraft: (text: string) => Promise<AgentPendingFile>
  makeUniqueFilename: (name: string, existing: string[]) => string
  addFilesAsAttachments: (files: File[], sourcePaths?: Map<File, string>) => Promise<void>
  addLargeDialogFilesAsReferences: (files: FileDialogLargeFile[]) => Promise<void>
}

export function useAgentFileAttach(sessionId: string): AgentFileAttachResult {
  const [pendingFiles, setPendingFiles] = useAtom(agentPendingFilesAtomFamily(sessionId))
  const attachedDirsMap = useAtomValue(agentAttachedDirectoriesMapAtom)
  const attachedDirs = attachedDirsMap.get(sessionId) ?? []
  const setAttachedDirsMap = useSetAtom(agentAttachedDirectoriesMapAtom)
  const attachedFilesMap = useAtomValue(agentAttachedFilesMapAtom)
  const attachedFiles = attachedFilesMap.get(sessionId) ?? []
  const setAttachedFilesMap = useSetAtom(agentAttachedFilesMapAtom)
  const wsAttachedDirsMap = useAtomValue(workspaceAttachedDirectoriesMapAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const wsAttachedDirs = currentWorkspaceId ? (wsAttachedDirsMap.get(currentWorkspaceId) ?? []) : []
  const wsAttachedFilesMap = useAtomValue(workspaceAttachedFilesMapAtom)
  const wsAttachedFiles = currentWorkspaceId ? (wsAttachedFilesMap.get(currentWorkspaceId) ?? []) : []
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const setPreviewFileMap = useSetAtom(previewFileMapAtom)
  const [isDragOver, setIsDragOver] = React.useState(false)

  // pendingFiles ref（供 addFilesAsAttachments 读取最新列表，避免闭包旧值）
  const pendingFilesRef = React.useRef(pendingFiles)
  React.useEffect(() => { pendingFilesRef.current = pendingFiles }, [pendingFiles])

  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null

  const [workspaceFilesPath, setWorkspaceFilesPath] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!workspaceSlug) { setWorkspaceFilesPath(null); return }
    window.electronAPI.getWorkspaceFilesPath(workspaceSlug)
      .then(setWorkspaceFilesPath)
      .catch(() => setWorkspaceFilesPath(null))
  }, [workspaceSlug])

  // 工作区级目录
  const workspaceDirs = React.useMemo(() => {
    const dirs: string[] = []
    if (workspaceFilesPath) dirs.push(workspaceFilesPath)
    for (const d of wsAttachedDirs) {
      if (!dirs.includes(d)) dirs.push(d)
    }
    return dirs
  }, [workspaceFilesPath, wsAttachedDirs])

  const attachedFileDirectories = React.useMemo(() => {
    const dirs: string[] = []
    for (const filePath of [...attachedFiles, ...wsAttachedFiles]) {
      const parent = getFileParentPath(filePath)
      if (parent && !dirs.includes(parent)) dirs.push(parent)
    }
    return dirs
  }, [attachedFiles, wsAttachedFiles])

  const workspaceMentionPaths = React.useMemo(() => {
    const paths = [...workspaceDirs]
    for (const filePath of wsAttachedFiles) {
      if (!paths.includes(filePath)) paths.push(filePath)
    }
    return paths
  }, [workspaceDirs, wsAttachedFiles])

  const sessionMentionPaths = React.useMemo(() => {
    const paths = [...attachedDirs]
    for (const filePath of attachedFiles) {
      if (!paths.includes(filePath)) paths.push(filePath)
    }
    return paths
  }, [attachedDirs, attachedFiles])

  const allAttachedDirs = React.useMemo(() => {
    const dirs = [...attachedDirs]
    for (const d of workspaceDirs) {
      if (d && !dirs.includes(d)) dirs.push(d)
    }
    for (const filePath of [...attachedFiles, ...wsAttachedFiles]) {
      if (filePath && !dirs.includes(filePath)) dirs.push(filePath)
      const parent = getFileParentPath(filePath)
      if (parent && !dirs.includes(parent)) dirs.push(parent)
    }
    return dirs
  }, [attachedDirs, workspaceDirs, attachedFiles, wsAttachedFiles])

  const makeUniqueFilename = React.useCallback((originalName: string, existingNames: string[]): string => {
    return makeUniqueAttachmentName(originalName, existingNames)
  }, [])

  const attachSessionFile = React.useCallback(async (filePath: string): Promise<void> => {
    const updated = await window.electronAPI.attachFile({ sessionId, filePath })
    setAttachedFilesMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, updated)
      return map
    })
  }, [sessionId, setAttachedFilesMap])

  const addFilesAsAttachments = React.useCallback(async (files: File[], sourcePaths?: Map<File, string>): Promise<void> => {
    const usedNames: string[] = pendingFilesRef.current.map((f) => f.filename)
    const pathBackedFiles: string[] = []
    const rejectedLargeFiles: string[] = []

    for (const file of files) {
      try {
        if (file.size > MAX_ATTACHMENT_SIZE) {
          const sourcePath = sourcePaths?.get(file)
          if (!sourcePath) { rejectedLargeFiles.push(file.name); continue }
          await attachSessionFile(sourcePath)
          const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
          const uniqueFilename = makeUniqueFilename(file.name, usedNames)
          usedNames.push(uniqueFilename)
          const pending: AgentPendingFile = {
            id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            filename: uniqueFilename,
            mediaType: file.type || 'application/octet-stream',
            size: file.size,
            previewUrl,
            sourcePath,
          }
          setPendingFiles((prev) => [...prev, pending])
          pathBackedFiles.push(uniqueFilename)
          continue
        }

        const base64 = await fileToBase64(file)
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        const uniqueFilename = makeUniqueFilename(file.name, usedNames)
        usedNames.push(uniqueFilename)
        const pending: AgentPendingFile = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: uniqueFilename,
          mediaType: file.type || 'application/octet-stream',
          size: file.size,
          previewUrl,
        }
        if (!window.__pendingAgentFileData) {
          window.__pendingAgentFileData = new Map<string, string>()
        }
        window.__pendingAgentFileData.set(pending.id, base64)
        setPendingFiles((prev) => [...prev, pending])
      } catch (error) {
        console.error('[AgentView] 添加附件失败:', error)
      }
    }

    if (pathBackedFiles.length > 0) {
      toast.success(`已将大文件作为附加文件引用：${formatFileNames(pathBackedFiles)}`)
    }
    if (rejectedLargeFiles.length > 0) {
      toast.error(`以下文件超过 100MB 且无法取得本地路径，已跳过：${formatFileNames(rejectedLargeFiles)}`)
    }
  }, [attachSessionFile, makeUniqueFilename, setPendingFiles])

  const addLargeDialogFilesAsReferences = React.useCallback(async (files: FileDialogLargeFile[]): Promise<void> => {
    if (files.length === 0) return
    const usedNames: string[] = pendingFilesRef.current.map((f) => f.filename)
    const added: string[] = []
    const rejected: string[] = []

    for (const file of files) {
      try {
        await attachSessionFile(file.path)
        const uniqueFilename = makeUniqueFilename(file.filename, usedNames)
        usedNames.push(uniqueFilename)
        const pending: AgentPendingFile = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: uniqueFilename,
          mediaType: file.mediaType,
          size: file.size,
          sourcePath: file.path,
        }
        setPendingFiles((prev) => [...prev, pending])
        added.push(uniqueFilename)
      } catch (error) {
        console.error('[AgentView] 附加大文件失败:', error)
        rejected.push(file.filename)
      }
    }

    if (added.length > 0) toast.success(`已将大文件作为附加文件引用：${formatFileNames(added)}`)
    if (rejected.length > 0) toast.error(`以下文件附加失败，已跳过：${formatFileNames(rejected)}`)
  }, [attachSessionFile, makeUniqueFilename, setPendingFiles])

  const attachFromDialog = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFileDialog()
      const largeFiles = result.largeFiles ?? []
      const skippedFiles = result.skippedFiles ?? []
      if (result.files.length === 0 && largeFiles.length === 0 && skippedFiles.length === 0) return

      const oversized: string[] = []
      for (const fileInfo of result.files) {
        if (fileInfo.size > MAX_ATTACHMENT_SIZE) { oversized.push(fileInfo.filename); continue }
        const previewUrl = fileInfo.mediaType.startsWith('image/')
          ? `data:${fileInfo.mediaType};base64,${fileInfo.data}`
          : undefined
        const pending: AgentPendingFile = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: fileInfo.filename,
          mediaType: fileInfo.mediaType,
          size: fileInfo.size,
          previewUrl,
        }
        if (!window.__pendingAgentFileData) {
          window.__pendingAgentFileData = new Map<string, string>()
        }
        window.__pendingAgentFileData.set(pending.id, fileInfo.data)
        setPendingFiles((prev) => [...prev, pending])
      }

      if (oversized.length > 0) toast.error(`以下文件超过 100MB 且无法取得本地路径，已跳过：${formatFileNames(oversized)}`)
      await addLargeDialogFilesAsReferences(largeFiles)
      if (skippedFiles.length > 0) toast.warning(`以下文件无法读取，已跳过：${formatFileNames(skippedFiles.map((f) => f.filename))}`)
    } catch (error) {
      console.error('[AgentView] 文件选择对话框失败:', error)
    }
  }, [addLargeDialogFilesAsReferences, setPendingFiles])

  const attachFolder = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return
      const updated = await window.electronAPI.attachDirectory({ sessionId, directoryPath: result.path })
      setAttachedDirsMap((prev) => { const map = new Map(prev); map.set(sessionId, updated); return map })
      toast.success(`已附加目录: ${result.name}`)
    } catch (error) {
      console.error('[AgentView] 附加文件夹失败:', error)
      toast.error('附加文件夹失败')
    }
  }, [sessionId, setAttachedDirsMap])

  const removeFile = React.useCallback((id: string): void => {
    setPendingFiles((prev) => {
      const file = prev.find((f) => f.id === id)
      if (file?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl)
      window.__pendingAgentFileData?.delete(id)
      return prev.filter((f) => f.id !== id)
    })
  }, [setPendingFiles])

  const openClipboardPreviewFile = React.useCallback((filePath: string): void => {
    const parentPath = getFileParentPath(filePath)
    setPreviewFileMap((prev) => {
      const m = new Map(prev)
      m.set(sessionId, { filePath, previewOnly: true, readOnly: false, basePaths: parentPath ? [parentPath] : undefined })
      return m
    })
  }, [sessionId, setPreviewFileMap])

  const handleClipboardPreview = React.useCallback(async (file: AgentPendingFile) => {
    if (file.sourcePath) { openClipboardPreviewFile(file.sourcePath); return }
    const base64 = window.__pendingAgentFileData?.get(file.id)
    if (!base64) return
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const text = new TextDecoder('utf-8').decode(bytes)
      const tmpPath = await window.electronAPI.writeClipboardPreview(file.filename, text)
      setPendingFiles((prev) => prev.map((item) => (
        item.id === file.id ? { ...item, sourcePath: tmpPath, isClipboardDraft: true } : item
      )))
      window.__pendingAgentFileData?.delete(file.id)
      openClipboardPreviewFile(tmpPath)
    } catch (error) {
      console.error('[AgentView] clipboard 预览写入失败:', error)
    }
  }, [openClipboardPreviewFile, setPendingFiles])

  const addClipboardTextDraft = React.useCallback(async (text: string): Promise<AgentPendingFile> => {
    const draft = createClipboardTextDraft(text, pendingFilesRef.current.map((f) => f.filename))
    const tmpPath = await window.electronAPI.writeClipboardPreview(draft.filename, text)
    const pending = createClipboardPendingFile(draft, tmpPath, `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    setPendingFiles((prev) => { const next = [...prev, pending]; pendingFilesRef.current = next; return next })
    return pending
  }, [setPendingFiles])

  const handlePasteFiles = React.useCallback((files: File[]): void => { addFilesAsAttachments(files) }, [addFilesAsAttachments])

  const handlePasteLongText = React.useCallback((text: string): void => {
    addClipboardTextDraft(text).then((file) => {
      toast.success('已将超长文本转为附件', { description: `${file.filename}，点击附件可预览编辑。` })
    }).catch((error) => {
      console.error('[AgentView] 超长文本转附件失败:', error)
      toast.error('超长文本转附件失败')
    })
  }, [addClipboardTextDraft])

  const handleDragOver = React.useCallback((e: React.DragEvent): void => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true) }, [])
  const handleDragLeave = React.useCallback((e: React.DragEvent): void => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false) }, [])

  const handleDrop = React.useCallback(async (e: React.DragEvent): Promise<void> => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return
    const pathMap = new Map<string, File>()
    const paths: string[] = []
    for (const f of droppedFiles) {
      try { const p = window.electronAPI.getPathForFile(f); if (p) { paths.push(p); pathMap.set(p, f) } } catch { /* ignore */ }
    }
    if (paths.length > 0) {
      try {
        const { directories, files: filePaths } = await window.electronAPI.checkPathsType(paths)
        for (const dirPath of directories) {
          try {
            const updated = await window.electronAPI.attachDirectory({ sessionId, directoryPath: dirPath })
            setAttachedDirsMap((prev) => { const map = new Map(prev); map.set(sessionId, updated); return map })
            toast.success(`已附加目录: ${dirPath.split('/').pop() || dirPath}`)
          } catch (error) { console.error('[AgentView] 拖拽附加文件夹失败:', error) }
        }
        const regularFiles = filePaths.map((p) => pathMap.get(p)!).filter(Boolean)
        if (regularFiles.length > 0) {
          const fileSourcePaths = new Map<File, string>()
          for (const path of filePaths) { const file = pathMap.get(path); if (file) fileSourcePaths.set(file, path) }
          addFilesAsAttachments(regularFiles, fileSourcePaths)
        }
      } catch (error) {
        console.error('[AgentView] 路径检测失败，回退处理:', error)
        addFilesAsAttachments(droppedFiles)
      }
    } else {
      addFilesAsAttachments(droppedFiles)
    }
  }, [sessionId, addFilesAsAttachments, setAttachedDirsMap])

  return {
    pendingFiles, setPendingFiles, attachedDirs, attachedFiles, wsAttachedDirs, wsAttachedFiles,
    workspaceDirs, attachedFileDirectories, workspaceMentionPaths, sessionMentionPaths, allAttachedDirs,
    isDragOver, pendingFilesRef, attachFromDialog, attachFolder, removeFile, handleDrop,
    handleDragOver, handleDragLeave, handlePasteFiles, handlePasteLongText, handleClipboardPreview,
    addClipboardTextDraft, makeUniqueFilename, addFilesAsAttachments, addLargeDialogFilesAsReferences,
    hasAvailableModel: false,
  }
}
