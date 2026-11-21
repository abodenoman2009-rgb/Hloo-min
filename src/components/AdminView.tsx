import { useEffect, useState } from 'react';
import { Check, Shield, Trash2, UserCheck, UserX, X } from 'lucide-react';
import { t } from '../i18n';
import { api } from '../lib/api';
import { formatMessageTime } from '../lib/connectLogic';
import type {
  AppSettings,
  Language,
  ReportRecord,
  ReportStatus,
  UserProfile,
} from '../types';
import { Avatar } from './Avatar';

interface AdminViewProps {
  lang: Language;
  currentUser: UserProfile;
  onSettingsUpdated: (settings: AppSettings) => void;
}

export function AdminView({
  lang,
  currentUser,
  onSettingsUpdated,
}: AdminViewProps) {
  const dict = t(lang);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [callCount, setCallCount] = useState(0);
  const [settings, setSettings] = useState<AppSettings>({
    maintenance_mode: { enabled: false, message_ar: '', message_en: '' },
    calls_enabled: { audio: true, video: true, max_group_participants: 8 },
  });
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getAdminOverview()
      .then((res) => {
        setUsers(res.users);
        setReports(res.reports);
        setSettings(res.settings);
        setCallCount(res.callCount);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleReportAction(id: string, status: ReportStatus) {
    const res = await api.updateReportStatus(id, status);
    setReports(res.reports);
  }

  async function handleToggleBan(user: UserProfile) {
    const res = await api.adminUpdateUser(user.id, { is_banned: !user.is_banned });
    setUsers(res.users);
  }

  async function handleToggleRole(user: UserProfile) {
    const nextRole = user.role === 'admin' ? 'user' : 'admin';
    const res = await api.adminUpdateUser(user.id, { role: nextRole });
    setUsers(res.users);
  }

  async function handleSaveSettings() {
    setSavedMsg(null);
    const res1 = await api.adminUpdateSetting(
      'maintenance_mode',
      settings.maintenance_mode
    );
    const res2 = await api.adminUpdateSetting(
      'calls_enabled',
      settings.calls_enabled
    );
    const latest = res2.settings || res1.settings;
    setSettings(latest);
    onSettingsUpdated(latest);
    setSavedMsg(dict.savedSuccess);
    window.setTimeout(() => setSavedMsg(null), 2500);
  }

  const pendingReportsCount = reports.filter((r) => r.status === 'pending').length;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {dict.adminTitle}
            </h1>
          </div>
          {savedMsg && (
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {savedMsg}
            </span>
          )}
        </div>

        {/* Summary Metrics Row (1-level clean grid, tabular-nums) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {dict.totalUsers}
            </div>
            <div className="mt-1 text-2xl font-bold font-mono-tabular text-slate-900 dark:text-white">
              {users.length}
            </div>
          </div>
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {dict.pendingReports}
            </div>
            <div className="mt-1 text-2xl font-bold font-mono-tabular text-amber-600 dark:text-amber-400">
              {pendingReportsCount}
            </div>
          </div>
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {dict.totalCalls}
            </div>
            <div className="mt-1 text-2xl font-bold font-mono-tabular text-slate-900 dark:text-white">
              {callCount}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">...</div>
        ) : (
          <>
            {/* Global System Settings */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {dict.globalSettings}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Maintenance Mode */}
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        {dict.maintenanceMode}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {dict.maintenanceEnabledDesc}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      aria-label={dict.maintenanceMode}
                      checked={settings.maintenance_mode.enabled}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          maintenance_mode: {
                            ...s.maintenance_mode,
                            enabled: e.target.checked,
                          },
                        }))
                      }
                      className="w-5 h-5 accent-emerald-700 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {dict.maintenanceMsgAr}
                    </label>
                    <input
                      type="text"
                      value={settings.maintenance_mode.message_ar}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          maintenance_mode: {
                            ...s.maintenance_mode,
                            message_ar: e.target.value,
                          },
                        }))
                      }
                      className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {dict.maintenanceMsgEn}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={settings.maintenance_mode.message_en}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          maintenance_mode: {
                            ...s.maintenance_mode,
                            message_en: e.target.value,
                          },
                        }))
                      }
                      className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                    />
                  </div>
                </div>

                {/* Calls Policy */}
                <div className="space-y-4">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {dict.callsPolicy}
                  </div>
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      {dict.allowAudioCalls}
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.calls_enabled.audio}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          calls_enabled: {
                            ...s.calls_enabled,
                            audio: e.target.checked,
                          },
                        }))
                      }
                      className="w-5 h-5 accent-emerald-700"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      {dict.allowVideoCalls}
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.calls_enabled.video}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          calls_enabled: {
                            ...s.calls_enabled,
                            video: e.target.checked,
                          },
                        }))
                      }
                      className="w-5 h-5 accent-emerald-700"
                    />
                  </label>
                  <div>
                    <label
                      htmlFor="max-group-participants"
                      className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
                    >
                      {dict.maxGroupParticipants}
                    </label>
                    <input
                      id="max-group-participants"
                      type="number"
                      min={2}
                      max={32}
                      value={settings.calls_enabled.max_group_participants}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          calls_enabled: {
                            ...s.calls_enabled,
                            max_group_participants: Math.max(
                              2,
                              Number(e.target.value) || 2
                            ),
                          },
                        }))
                      }
                      className="w-32 h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono-tabular"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="h-10 px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  {dict.saveSettings}
                </button>
              </div>
            </section>

            {/* Reports Queue */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {dict.reportsQueue}
              </h2>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800">
                {reports.map((rep) => (
                  <div
                    key={rep.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        {rep.reported_user?.full_name || rep.reported_user_id}
                        <span className="text-slate-400 font-normal"> · </span>
                        <span className="text-xs font-normal text-slate-500">
                          {rep.reason}
                        </span>
                      </div>
                      {rep.details && (
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {rep.details}
                        </p>
                      )}
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{rep.reporter?.full_name}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono-tabular">
                          {formatMessageTime(rep.created_at, lang)}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span className="font-semibold">{rep.status}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleReportAction(rep.id, 'resolved')}
                        className="min-h-[36px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{dict.resolve}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReportAction(rep.id, 'dismissed')}
                        className="min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>{dict.dismiss}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Users Directory */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {dict.usersDirectory}
              </h2>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="py-3 px-4 text-start font-semibold">
                        {dict.fullName}
                      </th>
                      <th className="py-3 px-4 text-start font-semibold">
                        {dict.username}
                      </th>
                      <th className="py-3 px-4 text-start font-semibold">
                        {lang === 'ar' ? 'الدور' : 'Role'}
                      </th>
                      <th className="py-3 px-4 text-start font-semibold">
                        {lang === 'ar' ? 'الحالة' : 'Status'}
                      </th>
                      <th className="py-3 px-4 text-end font-semibold">
                        {lang === 'ar' ? 'إجراءات' : 'Actions'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <Avatar
                              src={u.avatar_url}
                              name={u.full_name}
                              size="xs"
                              isOnline={u.is_online}
                            />
                            <span className="font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                              {u.full_name}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-500 font-mono-tabular">
                          <span dir="ltr" className="inline-block">@{u.username}</span>
                        </td>
                        <td className="py-3 px-4 text-xs font-medium">
                          {u.role === 'admin' ? dict.adminBadge : dict.memberBadge}
                        </td>
                        <td className="py-3 px-4 text-xs font-semibold">
                          <span
                            className={
                              u.is_banned
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }
                          >
                            {u.is_banned ? dict.bannedTag : dict.activeTag}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-2">
                            {u.id !== currentUser.id && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleToggleRole(u)}
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                                >
                                  {u.role === 'admin'
                                    ? dict.makeUser
                                    : dict.makeAdmin}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleBan(u)}
                                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap ${
                                    u.is_banned
                                      ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                                      : 'border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30'
                                  }`}
                                >
                                  {u.is_banned ? (
                                    <>
                                      <UserCheck className="w-3.5 h-3.5" />
                                      <span>{dict.unbanUser}</span>
                                    </>
                                  ) : (
                                    <>
                                      <UserX className="w-3.5 h-3.5" />
                                      <span>{dict.banUser}</span>
                                    </>
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
