import * as React from 'react'
import { FileText, FileImage, Download, Quote } from 'lucide-react'
import { ImageLightbox } from '@/components/ui/image-lightbox'

export interface AttachedFileRef {
  filename: string
  path: string
}

export interface QuotedFileRef {
  path: string
  filename: string
}

export function parseAttachedFiles(content: string): { files: AttachedFileRef[]; quotes: QuotedFileRef[]; text: string } {
  const quoteRegex = /<quoted_file[^>]*>[\s\S]*?<\/quoted_file>\n*/g
  const quotes: QuotedFileRef[] = []
  let quoteMatch: RegExpExecArray | null
  while ((quoteMatch = quoteRegex.exec(content)) !== null) {
    const pathMatch = quoteMatch[0].match(/path="([^"]*)"/)
    if (pathMatch) {
      const filePath = pathMatch[1]!
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
      quotes.push({ path: filePath, filename: filePath.split('/').pop() ?? filePath })
    }
  }

  const regex = /<attached_files>\n?([\s\S]*?)\n?<\/attached_files>\n*/
  const match = content.match(regex)
  if (!match) {
    const cleanText = content.replace(/<quoted_file[^>]*>[\s\S]*?<\/quoted_file>\n*/g, '').trim()
    return { files: [], quotes, text: cleanText }
  }

  const files: AttachedFileRef[] = []
  const lines = match[1]!.split('\n')
  for (const line of lines) {
    const lineMatch = line.match(/^-\s+(.+?):\s+(.+)$/)
    if (lineMatch) {
      files.push({ filename: lineMatch[1]!.trim(), path: lineMatch[2]!.trim() })
    }
  }

  let text = content.replace(regex, '')
  text = text.replace(/<quoted_file[^>]*>[\s\S]*?<\/quoted_file>\n*/g, '')
  text = text.trim()
  return { files, quotes, text }
}

export function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename)
}

export function AttachedImageThumb({ file }: { file: AttachedFileRef }): React.ReactElement {
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = React.useState(false)

  React.useEffect(() => {
    const ext = file.filename.split('.').pop()?.toLowerCase() ?? 'png'
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    }
    const mediaType = mimeMap[ext] ?? 'image/png'
    window.electronAPI
      .readAttachment(file.path)
      .then((base64) => setImageSrc(`data:${mediaType};base64,${base64}`))
      .catch((err) => console.error('[AttachedImageThumb] 读取附件失败:', err))
  }, [file.path, file.filename])

  const handleSave = React.useCallback((): void => {
    window.electronAPI.saveImageAs(file.path, file.filename)
  }, [file.path, file.filename])

  if (!imageSrc) {
    return <div className="w-[200px] h-[140px] rounded-lg bg-muted/30 animate-pulse shrink-0" />
  }

  return (
    <div className="relative group inline-block">
      <img
        src={imageSrc}
        alt={file.filename}
        className="max-w-[300px] max-h-[200px] rounded-lg object-contain cursor-pointer"
        onClick={() => setLightboxOpen(true)}
      />
      <button
        type="button"
        onClick={handleSave}
        className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
        title="保存图片"
      >
        <Download className="size-4" />
      </button>
      <ImageLightbox
        src={imageSrc}
        alt={file.filename}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onSave={handleSave}
      />
    </div>
  )
}

export function AttachedFileChip({ file }: { file: AttachedFileRef }): React.ReactElement {
  const isImg = isImageFile(file.filename)
  const Icon = isImg ? FileImage : FileText

  return (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-[12px] text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate max-w-[200px]">{file.filename}</span>
    </div>
  )
}

export function QuoteChip({ quote }: { quote: QuotedFileRef }): React.ReactElement {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-primary/8 border border-primary/20 px-2.5 py-1 text-[12px] text-muted-foreground">
      <Quote className="size-3.5 shrink-0 text-primary/60" />
      <span className="truncate max-w-[200px]">{quote.filename}</span>
    </div>
  )
}
