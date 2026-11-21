import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Globe, LogOut, Moon, Sun, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import { api } from '../lib/api';
import type { Language, ThemeMode, UserProfile } from '../types';
import { Avatar } from './Avatar';

interface SettingsViewProps {
  lang: Language;
  theme: ThemeMode;
  currentUser: UserProfile;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  onProfileUpdated: (user: UserProfile) => void;
  onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
}

export function SettingsView({
  lang,
  theme,
  currentUser,
  onToggleLang,
  onToggleTheme,
  onProfileUpdated,
  onSignOut,
  onDeleteAccount,
}: SettingsViewProps) {
  const dict = t(lang);
  const [fullName, setFullName] = useState(currentUser.full_name);
  const [username, setUsername] = useState(currentUser.username);
  const [bio, setBio] = useState(currentUser.bio);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUser.avatar_url);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await api.uploadMedia(String(reader.result), file.type);
        setAvatarUrl(res.url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.updateMe({
        full_name: fullName,
        username,
        bio,
        avatar_url: avatarUrl,
      });
      onProfileUpdated(res.user);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          {dict.settings}
        </h1>

        {/* Profile Form */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {dict.profileSettings}
            </h2>
            {saved && (
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                {dict.savedSuccess}
              </span>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center gap-4">
            <Avatar src={avatarUrl} name={fullName || currentUser.full_name} size="xl" />
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
              >
                <Camera className="w-4 h-4" />
                <span>{dict.changeAvatar}</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  {dict.fullName}
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  {dict.username}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                {dict.bio}
              </label>
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="h-10 px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                {dict.saveProfile}
              </button>
            </div>
          </form>
        </section>

        {/* Preferences */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {dict.preferences}
          </h2>
          <div className="flex items-center justify-between gap-4 py-2">
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {dict.languageLabel}
            </span>
            <button
              type="button"
              onClick={onToggleLang}
              className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
            >
              <Globe className="w-4 h-4" />
              <span>{lang === 'ar' ? 'العربية (RTL) → English' : 'English (LTR) → العربية'}</span>
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 py-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {dict.themeLabel}
            </span>
            <button
              type="button"
              onClick={onToggleTheme}
              className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span>{dict.lightMode}</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-600" />
                  <span>{dict.darkMode}</span>
                </>
              )}
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 py-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {currentUser.email}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
            >
              <LogOut className="w-4 h-4" />
              <span>{dict.signOut}</span>
            </button>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/60 rounded-2xl p-6 space-y-4">
          <h2 className="text-base font-bold text-red-600 dark:text-red-400">
            {dict.dangerZone}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {dict.deleteAccountWarn}
          </p>
          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="h-10 px-4 rounded-xl border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
            >
              <Trash2 className="w-4 h-4" />
              <span>{dict.deleteAccount}</span>
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onDeleteAccount}
                className="h-10 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold whitespace-nowrap"
              >
                {dict.confirmDelete}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold whitespace-nowrap"
              >
                {dict.cancel}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
