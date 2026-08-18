import { forwardRef } from "react";
import { Icon } from "@iconify/react";

export type ThemeMode = "auto" | "light" | "dark";

interface Props {
  query: string;
  onQuery: (q: string) => void;
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef: React.Ref<HTMLInputElement>;
  scope: string | null;
  scopeName: string;
  scopeSelected: boolean;
  onPillClick: () => void;
  onPillRemove: () => void;
  themeMode: ThemeMode;
  effectiveTheme: "dark" | "light";
  onThemeModeChange: (mode: ThemeMode) => void;
}

export const Topbar = forwardRef<HTMLInputElement, Props>(function Topbar(
  {
    query,
    onQuery,
    onInputKeyDown,
    inputRef,
    scope,
    scopeName,
    scopeSelected,
    onPillClick,
    onPillRemove,
    themeMode,
    effectiveTheme,
    onThemeModeChange,
  },
  _ref,
) {
  const getThemeLabel = (mode: ThemeMode) => {
    if (mode === "auto") return "跟随系统";
    if (mode === "light") return "亮色主题";
    return "暗色主题";
  };

  return (
    <header className="topbar">
      <div className="search">
        <Icon icon="lucide:search" className="search-icon" />
        {scope && (
          <div className={`scope-pill ${scopeSelected ? "pill-selected" : ""}`}>
            <button
              type="button"
              className="pill-main"
              onClick={onPillClick}
              title={`回到 ${scopeName}`}
            >
              <Icon icon="lucide:library" />
              <span className="scope-pill-label">{scopeName}</span>
            </button>
            <button
              type="button"
              className="pill-x"
              onClick={onPillRemove}
              title="移除当前库筛选"
              aria-label={`移除 ${scopeName}`}
            >
              <svg
                className="pill-x-icon"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden
              >
                <g clip-path="url(#pill-x-clip)">
                  <path
                    opacity="0.5"
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M8 0C12.4183 0 16 3.58172 16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0ZM8 6.93945L4.53027 3.46973L3.46973 4.53027L6.93945 8L3.46973 11.4697L4.53027 12.5303L8 9.06055L11.4697 12.5303L12.5303 11.4697L9.06055 8L12.5303 4.53027L11.4697 3.46973L8 6.93945Z"
                    fill="currentColor"
                  />
                </g>
                <defs>
                  <clipPath id="pill-x-clip">
                    <rect width="16" height="16" fill="currentColor" />
                  </clipPath>
                </defs>
              </svg>
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={scope ? `在 ${scopeName} 内搜索` : "搜索图标 · 支持组合关键词（如：首页 wifi / arrow left）"}
          title={scope ? undefined : "支持多关键词组合搜索，空格分隔：如 箭头 向下 / home wifi"}
          spellCheck={false}
          autoFocus
        />
        {query ? (
          <button
            className="search-clear"
            onClick={() => onQuery("")}
            title="清空"
          >
            <Icon icon="lucide:x" />
          </button>
        ) : (
          <span className="kbd">
            <Icon icon="lucide:command" />F
          </span>
        )}
      </div>

      <div className="topbar-right">
        <div className="theme-dropdown">
          <button
            className="theme-btn"
            type="button"
            title={`切换主题（当前：${getThemeLabel(themeMode)}）`}
          >
            <Icon
              icon={effectiveTheme === "light" ? "ri:sun-line" : "ri:moon-line"}
              className="theme-btn-icon"
            />
          </button>
          <div className="theme-menu">
            <button
              type="button"
              className={`theme-menu-item ${themeMode === "auto" ? "active" : ""}`}
              onClick={() => onThemeModeChange("auto")}
            >
              <Icon icon="ri:computer-line" />
              <span>跟随系统</span>
              {themeMode === "auto" && <Icon icon="ri:check-line" className="check-icon" />}
            </button>
            <button
              type="button"
              className={`theme-menu-item ${themeMode === "light" ? "active" : ""}`}
              onClick={() => onThemeModeChange("light")}
            >
              <Icon icon="ri:sun-line" />
              <span>亮色主题</span>
              {themeMode === "light" && <Icon icon="ri:check-line" className="check-icon" />}
            </button>
            <button
              type="button"
              className={`theme-menu-item ${themeMode === "dark" ? "active" : ""}`}
              onClick={() => onThemeModeChange("dark")}
            >
              <Icon icon="ri:moon-line" />
              <span>暗色主题</span>
              {themeMode === "dark" && <Icon icon="ri:check-line" className="check-icon" />}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
});