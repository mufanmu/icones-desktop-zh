import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, loadIcon } from "@iconify/react";
import type { IconifyIcon } from "@iconify/types";
import {
  buildSvg,
  toFormat,
  DEFAULT_OPTIONS,
  EXPORT_FORMATS,
  type RenderOptions,
  type ExportFormat,
} from "../lib/svg";
import { startNativeFileDrag } from "../lib/dragExport";
import { saveSvgFile } from "../lib/dragExport";

interface Props {
  name: string; // full "prefix:name"
  onClose: () => void;
  onNavigateToSet?: (prefix: string) => void;
  isFavIcon?: boolean;
  onToggleFavIcon?: (iconName: string) => void;
}

function clampNum(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Strip leading zeros for integer strings: "080" -> "80", "-000" -> "0"
function stripLeadingZeros(s: string) {
  if (s === "" || s === "-") return s;
  const m = s.match(/^(-?)0*(\d+)$/);
  if (!m) return s;
  const sign = m[1];
  const digits = m[2];
  return sign + (digits === "" ? "0" : digits.replace(/^0+/, "") || "0");
}

const SWATCHES = ["#ffffff", "#0a0a0a", "#6366f1", "#22c55e", "#ef4444", "#f59e0b", "#06b6d4"];

export function ExportPanel({
  name,
  onClose,
  onNavigateToSet,
  isFavIcon,
  onToggleFavIcon,
}: Props) {
  const [raw, setRaw] = useState<IconifyIcon | null>(null);
  const [opts, setOpts] = useState<RenderOptions>(DEFAULT_OPTIONS);
  const [bg, setBg] = useState<string | null>(null); // preview only
  const [format, setFormat] = useState<ExportFormat>("SVG");
  const [action, setAction] = useState<"Copy" | "Download">("Copy");
  // 操作完成反馈：Copy → "Copied"，Download → "Saved"（下载成功却说 Copied 会误导）
  const [done, setDone] = useState<null | "copied" | "saved">(null);
  const colorInput = useRef<HTMLInputElement>(null);

  const shortName = name.split(":").pop() ?? name;
  const prefix = name.includes(":") ? name.split(":")[0] : "";

  const navigateToSet = () => {
    if (!prefix || !onNavigateToSet) return;
    onNavigateToSet(prefix);
    onClose();
  };

  useEffect(() => {
    let alive = true;
    setRaw(null);
    loadIcon(name)
      .then((data) => alive && setRaw(data))
      .catch(() => alive && setRaw(null));
    return () => {
      alive = false;
    };
  }, [name]);

  const svg = useMemo(() => (raw ? buildSvg(raw, opts) : ""), [raw, opts]);

  const set = <K extends keyof RenderOptions>(k: K, v: RenderOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v }));

  async function onExport() {
    if (!svg) return;
    const out = toFormat(svg, format, shortName);
    if (action === "Download") {
      // 各格式对应的扩展名与 MIME：Data URL 是给 CSS/HTML 内嵌用的
      // URI 文本，存成 .txt，不能伪装成 .svg（旧逻辑会把 data: 这行
      // 字符串写进 .svg 文件，目标软件打不开）
      const meta =
        format === "React"
          ? { ext: "tsx", mime: "text/plain" }
          : format === "JSX"
            ? { ext: "jsx", mime: "text/plain" }
            : format === "Data URL"
              ? { ext: "txt", mime: "text/plain" }
              : { ext: "svg", mime: "image/svg+xml" };
      const fileName = `${shortName}.${meta.ext}`;
      // WKWebView 对 blob <a download> 下载支持不可靠，走 Rust 落盘到下载目录
      const path = await saveSvgFile(fileName, out, "Downloads");
      if (path) {
        setDone("saved");
        setTimeout(() => setDone(null), 1500);
        return;
      }
      // 浏览器环境（dev 预览）回退到 blob 下载
      const blob = new Blob([out], { type: meta.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setDone("saved");
      setTimeout(() => setDone(null), 1500);
    } else {
      try {
        await navigator.clipboard.writeText(out);
      } catch {
        /* clipboard blocked — ignore */
      }
      setDone("copied");
      setTimeout(() => setDone(null), 1200);
    }
  }

  return (
    <div className="export-panel">
      <div className="export-head">
        <div className="export-head-info">
          <span className="export-title">{shortName}</span>
          {prefix && (
            <span
              className="set-link"
              title={`在 app 内打开图标库：${prefix}`}
              onClick={navigateToSet}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigateToSet();
                }
              }}
            >
              <Icon icon="lucide:library" />
              {prefix}
              <Icon icon="lucide:arrow-right" />
            </span>
          )}
        </div>
        <div className="export-head-actions">
          {onToggleFavIcon && (
            <button
              className={`icon-btn ${isFavIcon ? "active-fav" : ""}`}
              title={isFavIcon ? "取消收藏" : "收藏图标"}
              onClick={() => onToggleFavIcon(name)}
            >
              <Icon icon={isFavIcon ? "ri:star-fill" : "ri:star-line"} />
            </button>
          )}
          <button className="icon-btn" title="Reset" onClick={() => setOpts(DEFAULT_OPTIONS)}>
            <Icon icon="lucide:rotate-ccw" />
          </button>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <Icon icon="lucide:x" />
          </button>
        </div>
      </div>

      <div className="export-body">
        <div
          className={`preview ${bg ? "" : "checker"}`}
          style={bg ? { background: bg } : undefined}
          draggable={!!svg}
          onDragStart={(e) => {
            if (svg) startNativeFileDrag(e, svg, name);
          }}
          title={
            svg
              ? "拖拽导出：保存到桌面 / 携带 SVG 源码(可粘贴进 Figma 二次编辑)"
              : undefined
          }
        >
          {svg ? (
            <div className="preview-svg" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <Icon icon="svg-spinners:90-ring-with-bg" className="spinner" />
          )}
        </div>

        <div className="controls">
          <div className="control-row">
            <Field label="Size">
              <NumInput value={opts.size} min={4} max={512} onChange={(v) => set("size", v)} suffix="px" />
            </Field>
            <Field label="Padding">
              <NumInput value={opts.padding} min={0} max={256} onChange={(v) => set("padding", v)} suffix="px" />
            </Field>
            <Field label="Rotate">
              <NumInput value={opts.rotate} min={-360} max={360} onChange={(v) => set("rotate", v)} suffix="deg" />
            </Field>
            <Field label="Flip">
              <div className="btn-pair">
                <button className={opts.hFlip ? "active" : ""} onClick={() => set("hFlip", !opts.hFlip)} title="Flip horizontal">
                  <Icon icon="lucide:flip-horizontal-2" />
                </button>
                <button className={opts.vFlip ? "active" : ""} onClick={() => set("vFlip", !opts.vFlip)} title="Flip vertical">
                  <Icon icon="lucide:flip-vertical-2" />
                </button>
              </div>
            </Field>
          </div>

          <div className="control-row">
            <Field label="Bg">
              <div className="swatch-row">
                <button
                  className={`swatch checker ${bg === null ? "sel" : ""}`}
                  title="Transparent"
                  onClick={() => setBg(null)}
                />
                <button
                  className={`swatch ${bg === "#0a0a0a" ? "sel" : ""}`}
                  style={{ background: "#0a0a0a" }}
                  onClick={() => setBg("#0a0a0a")}
                />
                <button
                  className={`swatch ${bg === "#ffffff" ? "sel" : ""}`}
                  style={{ background: "#ffffff" }}
                  onClick={() => setBg("#ffffff")}
                />
              </div>
            </Field>

            <Field label="Colors">
              <div className="swatch-row">
                <button
                  className="swatch big"
                  style={{ background: opts.currentColor ? "transparent" : opts.color }}
                  onClick={() => colorInput.current?.click()}
                  title="Pick color"
                >
                  {opts.currentColor && <Icon icon="lucide:pipette" />}
                </button>
                {SWATCHES.slice(0, 4).map((c) => (
                  <button
                    key={c}
                    className={`swatch sm ${!opts.currentColor && opts.color === c ? "sel" : ""}`}
                    style={{ background: c }}
                    onClick={() => {
                      set("currentColor", false);
                      set("color", c);
                    }}
                  />
                ))}
                <input
                  ref={colorInput}
                  type="color"
                  className="hidden-color"
                  value={opts.color}
                  onChange={(e) => {
                    set("currentColor", false);
                    set("color", e.target.value);
                  }}
                />
              </div>
            </Field>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={opts.currentColor}
                onChange={(e) => set("currentColor", e.target.checked)}
              />
              <span>currentColor</span>
            </label>
          </div>

          <div className="export-row">
            <span className="export-label">Export</span>
            <div className="selects">
              <select value={action} onChange={(e) => setAction(e.target.value as any)}>
                <option>Copy</option>
                <option>Download</option>
              </select>
              <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                {EXPORT_FORMATS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>
            <button className="primary-btn" onClick={onExport}>
              {done ? (
                <>
                  <Icon icon="lucide:check" />{" "}
                  {done === "saved" ? "Saved" : "Copied"}
                </>
              ) : (
                <>
                  {action} <Icon icon={action === "Copy" ? "lucide:copy" : "lucide:download"} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
  suffix,
  sliderStep = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
  sliderStep?: number;
}) {
  // Local text state decoupled from the parent number state, so typing
  // "24" on an "18" value does NOT get mid-keystroke clamped to "4" then
  // appended into "44", and prefix zeroes like "080" are stripped.
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // When not editing, mirror the (possibly slider-driven) external value.
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  const commit = (raw: string) => {
    if (raw === "" || raw === "-") return;
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    onChange(clampNum(n, min, max));
  };

  return (
    <div className="num-input-wrap">
      <input
        className="num-slider"
        type="range"
        value={value}
        min={min}
        max={max}
        step={sliderStep}
        onChange={(e) => onChange(clampNum(Number(e.target.value), min, max))}
      />
      <div className="num-input">
        <input
          type="number"
          value={text}
          min={min}
          max={max}
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            const v = stripLeadingZeros(e.target.value);
            setText(v);
            commit(v);
          }}
          onBlur={() => {
            setEditing(false);
            const n = Number(text);
            const clamped = Number.isNaN(n) ? min : clampNum(n, min, max);
            setText(String(clamped));
            onChange(clamped);
          }}
        />
        {suffix && <span>{suffix}</span>}
      </div>
    </div>
  );
}
