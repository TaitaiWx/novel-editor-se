/**
 * 三栏布局尺寸常量（卡片式三栏：窗口背景 + 左 / 中 / 右三张圆角卡片）
 * 左右面板没有最小宽度——拖到阈值以下会自动折叠
 *
 * 注意：PANE_GAP / PANE_PADDING 必须与 styles/global.scss 中的
 * `--ui-pane-gap` / `--ui-pane-padding` 保持一致（宽度计算依赖这两个值）。
 */
export const LEFT_COLLAPSED_WIDTH = 32;
export const RIGHT_COLLAPSED_WIDTH = 32;
export const LEFT_COLLAPSE_THRESHOLD = 100;
export const RIGHT_COLLAPSE_THRESHOLD = 120;
export const LEFT_MAX = 480;
export const RIGHT_MAX = 520;
export const CENTER_MIN = 320;
/** 卡片之间的间距；展开的侧栏与中间卡片之间由拖拽把手占据这段间距 */
export const PANE_GAP = 8;
/** 三栏容器左右两侧的外边距（卡片与窗口边缘的距离） */
export const PANE_PADDING = 8;
/** 三栏容器在水平方向上固定占用的宽度（左右外边距） */
export const PANE_CHROME = PANE_PADDING * 2;
