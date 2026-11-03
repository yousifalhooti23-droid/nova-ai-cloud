import { useMemo, useState } from 'react';
import { FileText, Image as ImageIcon, Video, FileCode, Paperclip, Download, ExternalLink, Trash2, Search, UploadCloud } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useChatStore } from '@/store/chat';
import { useCodeStore } from '@/store/code';
import { formatNumber } from '@/lib/format';
import { authMediaUrl, isImageMime, isVideoMime } from '@/lib/media';
import { Button, Modal, TextInput } from '@/components/ui';

export function FilesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const isAr = locale === 'ar';
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);
  const projects = useCodeStore((s) => s.projects);
  const activeProjectId = useCodeStore((s) => s.activeProjectId);
  const projectFiles = useCodeStore((s) => s.files);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'images' | 'documents' | 'code'>('all');

  // Collect all unique attachments across conversation messages
  const allAttachments = useMemo(() => {
    const list: { id: string; name: string; size: number; mime: string; url: string; source: string }[] = [];
    const seen = new Set<string>();

    for (const [convId, msgList] of Object.entries(messages)) {
      const conv = conversations.find((c) => c.id === convId);
      const title = conv?.title || 'محادثة';
      for (const msg of msgList) {
        if (Array.isArray(msg.attachments)) {
          for (const a of msg.attachments) {
            if (!seen.has(a.id) && !seen.has(a.url)) {
              seen.add(a.id);
              if (a.url) seen.add(a.url);
              list.push({
                id: a.id,
                name: a.name,
                size: a.size || 0,
                mime: a.mime || 'application/octet-stream',
                url: a.url,
                source: title,
              });
            }
          }
        }
      }
    }
    return list;
  }, [messages, conversations]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allAttachments.filter((f) => {
      if (q && !f.name.toLowerCase().includes(q) && !f.source.toLowerCase().includes(q)) return false;
      if (filter === 'images') return isImageMime(f.mime, f.name);
      if (filter === 'documents') return !isImageMime(f.mime, f.name) && !isVideoMime(f.mime, f.name);
      return true;
    });
  }, [allAttachments, search, filter]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isAr ? '📁 مدير الملفات والمرفقات السحابية' : '📁 Cloud Files & Attachments'}
      subtitle={
        isAr
          ? 'استعرض جميع المستندات، الصور، والمرفقات المحفوظة في محادثاتك ومشاريعك'
          : 'Browse all documents, images, and attachments saved across your chats and projects'
      }
      width={780}
      footer={<Button variant="ghost" onClick={onClose}>{isAr ? 'إغلاق' : 'Close'}</Button>}
    >
      <div className="flex flex-col gap-3">
        {/* Controls Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <div className="relative flex-1 w-full">
            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? 'بحث في الملفات والمرفقات...' : 'Search files & attachments...'}
              className="!ps-9 !py-1.5 !text-[12.5px]"
            />
          </div>

          <div className="flex items-center gap-1 self-start sm:self-auto overflow-x-auto no-scrollbar">
            {(['all', 'images', 'documents'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  filter === cat
                    ? 'bg-accent/15 text-accent font-semibold border border-accent/30'
                    : 'text-dim hover:bg-elevated hover:text-text border border-line'
                }`}
              >
                {cat === 'all'
                  ? isAr
                    ? 'الكل'
                    : 'All'
                  : cat === 'images'
                    ? isAr
                      ? 'الصور'
                      : 'Images'
                    : isAr
                      ? 'المستندات'
                      : 'Documents'}
              </button>
            ))}
          </div>
        </div>

        {/* Files Grid / List */}
        {filtered.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-line rounded-xl my-4">
            <UploadCloud size={32} className="mx-auto text-dim mb-2 opacity-50" />
            <p className="text-[13px] font-medium text-text">
              {isAr ? 'لا توجد ملفات مرفقة حتى الآن' : 'No attachments found'}
            </p>
            <p className="text-[11.5px] text-dim mt-1">
              {isAr
                ? 'ارفق أي ملف أو صورة في المحادثة أو صفحة البرمجة لتظهر هنا تلقائياً'
                : 'Attach any file or image in chat or coding to see it here automatically'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[460px] overflow-y-auto scroll-thin pe-1">
            {filtered.map((file) => {
              const isImg = isImageMime(file.mime, file.name);
              const isVid = isVideoMime(file.mime, file.name);
              const mediaSrc = authMediaUrl(file.url);

              return (
                <div
                  key={file.id}
                  className="nova-card p-3 flex items-center justify-between gap-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent overflow-hidden">
                      {isImg && mediaSrc ? (
                        <img src={mediaSrc} alt={file.name} className="h-full w-full object-cover" />
                      ) : isVid ? (
                        <Video size={18} />
                      ) : (
                        <FileText size={18} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-text" title={file.name}>
                        {file.name}
                      </p>
                      <p className="truncate text-[10.5px] text-dim">
                        {formatNumber(file.size)}B · {file.source}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {mediaSrc && (
                      <a
                        href={mediaSrc}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-lg text-dim hover:text-accent hover:bg-elevated transition-colors"
                        title={isAr ? 'فتح في علامة تبويب جديدة' : 'Open in new tab'}
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                    {mediaSrc && (
                      <a
                        href={mediaSrc}
                        download={file.name}
                        className="p-1.5 rounded-lg text-dim hover:text-accent hover:bg-elevated transition-colors"
                        title={isAr ? 'تنزيل' : 'Download'}
                      >
                        <Download size={14} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
