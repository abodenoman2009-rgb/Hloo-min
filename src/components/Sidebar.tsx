import {
  Globe,
  MessageSquare,
  Moon,
  Phone,
  Plus,
  Search,
  Settings,
  Shield,
  Sun,
  Users,
} from 'lucide-react';
import { t } from '../i18n';
import {
  filterConversations,
  formatMessageTime,
  getConversationDisplay,
} from '../lib/connectLogic';
import type {
  ActiveTab,
  ChatFilter,
  Conversation,
  Language,
  ThemeMode,
  UserProfile,
} from '../types';
import { Avatar } from './Avatar';

interface SidebarProps {
  lang: Language;
  theme: ThemeMode;
  currentUser: UserProfile;
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  conversations: Conversation[];
  selectedConversationId: string | null;
  onSelectConversation: (convId: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  chatFilter: ChatFilter;
  onChatFilterChange: (f: ChatFilter) => void;
  pendingFriendsCount: number;
  onOpenNewChat: () => void;
  onOpenNewGroup: () => void;
}

export function Sidebar({
  lang,
  theme,
  currentUser,
  activeTab,
  onSelectTab,
  onToggleLang,
  onToggleTheme,
  conversations,
  selectedConversationId,
  onSelectConversation,
  searchQuery,
  onSearchChange,
  chatFilter,
  onChatFilterChange,
  pendingFriendsCount,
  onOpenNewChat,
  onOpenNewGroup,
}: SidebarProps) {
  const dict = t(lang);
  const filtered = filterConversations(
    conversations,
    searchQuery,
    chatFilter,
    currentUser.id
  );
  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);

  const navItems: Array<{
    id: ActiveTab;
    label: string;
    icon: typeof MessageSquare;
    count?: number;
  }> = [
    { id: 'chats', label: dict.chats, icon: MessageSquare, count: totalUnread },
    { id: 'friends', label: dict.friends, icon: Users, count: pendingFriendsCount },
    { id: 'calls', label: dict.calls, icon: Phone },
    ...(currentUser.role === 'admin'
      ? [{ id: 'admin' as const, label: dict.admin, icon: Shield }]
      : []),
    { id: 'settings', label: dict.settings, icon: Settings },
  ];

  return (
    <aside className="w-full lg:w-[396px] shrink-0 border-e border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex h-full">
      {/* Desktop Vertical Workspace Rail */}
      <nav
        aria-label="Primary"
        className="hidden lg:flex flex-col items-center justify-between w-[84px] py-4 px-2 border-e border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 shrink-0"
      >
        <div className="flex flex-col items-center gap-2 w-full">
          <div className="mb-2">
            <Avatar
              src={currentUser.avatar_url}
              name={currentUser.full_name}
              size="md"
              isOnline={true}
            />
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative w-full py-2.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${
                  active
                    ? 'bg-emerald-700 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-[11px] font-semibold leading-tight text-center truncate max-w-full">
                  {item.label}
                </span>
                {typeof item.count === 'number' && item.count > 0 && (
                  <span
                    className={`absolute top-1.5 end-1.5 font-mono-tabular text-[10px] font-bold px-1.5 py-0.5 rounded-md leading-none ${
                      active
                        ? 'bg-white text-emerald-800'
                        : 'bg-emerald-700 text-white'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-2 w-full">
          <button
            type="button"
            onClick={onToggleLang}
            aria-label={dict.languageLabel}
            className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{lang === 'ar' ? 'EN' : 'AR'}</span>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? dict.lightMode : dict.darkMode}
            className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600" />
            )}
          </button>
        </div>
      </nav>

      {/* Conversations Column */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Header */}
        <div className="px-4 h-16 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="lg:hidden">
              <Avatar
                src={currentUser.avatar_url}
                name={currentUser.full_name}
                size="sm"
                isOnline={true}
              />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {dict.brand}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                <span dir="ltr" className="inline-block">@{currentUser.username}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenNewChat}
              className="min-h-[40px] px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              aria-label={dict.newChat}
            >
              <Plus className="w-4 h-4" />
              <span>{dict.newChat}</span>
            </button>
            <button
              type="button"
              onClick={onOpenNewGroup}
              className="min-h-[40px] min-w-[40px] px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium inline-flex items-center justify-center transition-colors shrink-0"
              aria-label={dict.newGroup}
            >
              <Users className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={dict.searchChats}
              aria-label={dict.searchChats}
              className="w-full h-10 ps-9 pe-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl">
            {(
              [
                { id: 'all', label: dict.filterAll },
                { id: 'unread', label: dict.filterUnread },
                { id: 'groups', label: dict.filterGroups },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onChatFilterChange(f.id)}
                className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  chatFilter === f.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 pb-16 lg:pb-0">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {lang === 'ar'
                ? 'لا توجد محادثات مطابقة للبحث.'
                : 'No conversations match your filter.'}
            </div>
          ) : (
            filtered.map((conv) => {
              const disp = getConversationDisplay(conv, currentUser.id, lang);
              const selected =
                activeTab === 'chats' && selectedConversationId === conv.id;
              const lastMsg = conv.last_message;
              let preview = '';
              if (lastMsg) {
                if (lastMsg.is_deleted) preview = dict.messageDeleted;
                else if (lastMsg.type === 'image')
                  preview = lang === 'ar' ? 'صورة مرفقة' : 'Photo attachment';
                else if (lastMsg.type === 'audio')
                  preview = lang === 'ar' ? 'رسالة صوتية' : 'Voice message';
                else if (lastMsg.type === 'location')
                  preview = lang === 'ar' ? 'موقع جغرافي' : 'Location pin';
                else preview = lastMsg.content;
              } else {
                preview = lang === 'ar' ? 'ابدأ المحادثة الآن' : 'Start chatting';
              }

              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => {
                    onSelectTab('chats');
                    onSelectConversation(conv.id);
                  }}
                  className={`w-full px-4 py-3.5 text-start flex items-center gap-3 transition-colors ${
                    selected
                      ? 'bg-emerald-50/90 dark:bg-emerald-950/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <Avatar
                    src={disp.avatarUrl}
                    name={disp.title}
                    size="md"
                    isOnline={disp.isOnline}
                    isGroup={conv.type === 'group'}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                        {disp.title}
                      </span>
                      <span className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                        {formatMessageTime(
                          lastMsg?.created_at || conv.last_message_at,
                          lang
                        )}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {preview}
                      </span>
                      {conv.unread_count > 0 && (
                        <span className="font-mono-tabular text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-700 text-white shrink-0 leading-none">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
