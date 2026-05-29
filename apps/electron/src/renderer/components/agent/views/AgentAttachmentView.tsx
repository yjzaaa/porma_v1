import * as React from 'react'
import { AttachmentPreviewItem } from '@/components/chat/AttachmentPreviewItem'
import { QuotedSelectionChip } from '@/components/diff/QuotedSelectionChip'
import type { AgentPendingFile } from '@proma/shared'

interface AgentAttachmentViewProps {
  pendingFiles: AgentPendingFile[]
  onRemoveFile: (id: string) => void
  onClipboardPreview: (file: AgentPendingFile) => void
  quotedSelection: { text: string; filePath: string } | null
  onRemoveQuotedSelection: () => void
}

export function AgentAttachmentView({
  pendingFiles,
  onRemoveFile,
  onClipboardPreview,
  quotedSelection,
  onRemoveQuotedSelection,
}: AgentAttachmentViewProps): React.ReactElement | null {
  if (pendingFiles.length === 0 && !quotedSelection) return null

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-2.5 pb-1.5">
      {pendingFiles.map((file) => (
        <AttachmentPreviewItem
          key={file.id}
          filename={file.filename}
          mediaType={file.mediaType}
          previewUrl={file.previewUrl}
          onRemove={() => onRemoveFile(file.id)}
          onClick={file.filename.startsWith('clipboard-') ? () => onClipboardPreview(file) : undefined}
        />
      ))}
      {quotedSelection && (
        <QuotedSelectionChip
          text={quotedSelection.text}
          filePath={quotedSelection.filePath}
          onRemove={onRemoveQuotedSelection}
        />
      )}
    </div>
  )
}
