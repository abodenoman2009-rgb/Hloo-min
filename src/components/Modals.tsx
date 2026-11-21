import { useEffect, useState, type FormEvent } from 'react';
import { Check, X } from 'lucide-react';
import { t } from '../i18n';
import { api } from '../lib/api';
import type { Language, UserProfile } from '../types';
import { Avatar } from './Avatar';

interface NewChatModalProps {
  lang: Language;
  mode: 'direct' | 'group' | null;
  onClose: () => void;
  onCreateDirect: (userId: string) => Promise<void>;
  onCreateGroup: (title: string, memberIds: string[]) => Promise<void>;
}

export function NewChatModal({
  lang,
  mode,
  onClose,
  onCreateDirect,
  onCreateGroup,
}: NewChatModalProps) {
  const dict = t(lang);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [query, setQuery] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mode) return;
    setSelectedIds([]);
    setGroupTitle('');
    setQuery('');
    api
      .searchUsers('')
      .then((res) => setUsers(res.users))
      .catch(() => {});
  }, [mode]);

  if (!mode) return null;

  const filtered = users.filter(
    (u) =>
      !query.trim() ||
      u.full_name.toLowerCase().includes(query.toLowerCase()) ||
      u.username.toLowerCase().includes(query.toLowerCase())
  );

  function toggleMember(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleGroupSubmit(e: FormEvent) {
    e.preventDefault();
    if (!groupTitle.trim() || selectedIds.length === 0) return;
    setBusy(true);
    try {
      await onCreateGroup(groupTitle.trim(), selectedIds);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'group' ? dict.createGroupTitle : dict.newChat}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {mode === 'group' ? dict.createGroupTitle : dict.newChat}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={dict.cancel}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {mode === 'group' && (
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              {dict.groupNameLabel}
            </label>
            <input
              type="text"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder={dict.groupNamePlaceholder}
              className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
            />
          </div>
        )}

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={dict.searchUsersPlaceholder}
          className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
        />

        <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.map((u) => {
            const checked = selectedIds.includes(u.id);
            return (
              <button
                key={u.id}
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (mode === 'direct') {
                    setBusy(true);
                    try {
                      await onCreateDirect(u.id);
                      onClose();
                    } finally {
                      setBusy(false);
                    }
                  } else {
                    toggleMember(u.id);
                  }
                }}
                className="w-full py-2.5 px-2 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-start rounded-xl"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    src={u.avatar_url}
                    name={u.full_name}
                    size="sm"
                    isOnline={u.is_online}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {u.full_name}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      @{u.username}
                    </div>
                  </div>
                </div>
                {mode === 'group' && checked && (
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {mode === 'group' && (
          <form onSubmit={handleGroupSubmit} className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              {dict.cancel}
            </button>
            <button
              type="submit"
              disabled={busy || !groupTitle.trim() || selectedIds.length === 0}
              className="h-10 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold"
            >
              {dict.create} ({selectedIds.length})
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

interface ReportModalProps {
  lang: Language;
  targetUser: UserProfile | null;
  onClose: () => void;
  onSubmit: (userId: string, reason: string, details: string) => Promise<void>;
}

export function ReportModal({
  lang,
  targetUser,
  onClose,
  onSubmit,
}: ReportModalProps) {
  const dict = t(lang);
  const [reason, setReason] = useState(
    lang === 'ar' ? 'محتوى غير لائق' : 'Inappropriate content'
  );
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  if (!targetUser) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!targetUser || !reason.trim()) return;
    setBusy(true);
    try {
      await onSubmit(targetUser.id, reason.trim(), details.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dict.reportTitle}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {dict.reportTitle}: {targetUser.full_name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={dict.cancel}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
            {dict.reportReason}
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
            {dict.reportDetails}
          </label>
          <textarea
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
          >
            {dict.cancel}
          </button>
          <button
            type="submit"
            disabled={busy || !reason.trim()}
            className="h-10 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
          >
            {dict.submitReport}
          </button>
        </div>
      </form>
    </div>
  );
}
