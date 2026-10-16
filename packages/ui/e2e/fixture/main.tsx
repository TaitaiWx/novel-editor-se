import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  Input,
  TextArea,
  Select,
  NumberInput,
  Checkbox,
  Switch,
  Tabs,
  Modal,
  SearchMultiSelect,
  DiffTextInput,
  ColorPicker,
  InlineRenameInput,
  Popover,
  ToastProvider,
  useToast,
  DialogProvider,
  useDialog,
} from '../../src';
import './styles.css';

const options = [
  { value: 'plan', label: '计划' },
  { value: 'held', label: '持有' },
  { value: 'done', label: '完成' },
];
function Fixture() {
  const [status, setStatus] = useState('plan');
  const [count, setCount] = useState(1);
  const [checked, setChecked] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [tab, setTab] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('旧称呼');
  const [color, setColor] = useState('#112233');
  const [modal, setModal] = useState(false);
  const [popover, setPopover] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('旧名.md');
  const [saved, setSaved] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const focus = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const dialog = useDialog();
  return (
    <main>
      <h1>共享 UI 集成测试</h1>
      <section aria-label="表单">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(String(new FormData(event.currentTarget).get('name')));
          }}
        >
          <Input name="name" aria-label="名称" defaultValue="林舟" />
          <Button type="submit">保存表单</Button>
          <Button type="button" disabled>
            禁用操作
          </Button>
        </form>
        <output id="saved">{saved}</output>
        <Select aria-label="状态" value={status} onChange={setStatus} options={options} />
        <NumberInput aria-label="数量" value={count} onChange={setCount} min={0} max={5} />
        <Checkbox checked={checked} onChange={setChecked} label="常驻" />
        <Switch checked={enabled} onChange={setEnabled} label="启用" />
        <TextArea aria-label="说明" defaultValue="背景说明" />
      </section>
      <section aria-label="导航">
        <Tabs
          label="筛选"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'all', label: '全部' },
            { id: 'disabled', label: '不可用', disabled: true },
            { id: 'done', label: '完成' },
          ]}
        />
        <output id="tab">{tab}</output>
        <SearchMultiSelect
          label="关联人物"
          value={selected}
          onChange={setSelected}
          options={[
            { value: 'lin', label: '林舟' },
            { value: 'su', label: '苏晴' },
          ]}
        />
        <output id="selected">{selected.join(',')}</output>
      </section>
      <section aria-label="编辑">
        <DiffTextInput aria-label="差异文本" value={text} baseline="旧称呼" onChange={setText} />
        <output id="current-text">{text}</output>
        <ColorPicker value={color} onChange={setColor} />
        <output id="color">{color}</output>
        {renaming ? (
          <InlineRenameInput
            initialValue={name}
            ariaLabel="重命名"
            selectEnd={name.length - 3}
            onCommit={(value) => {
              setName(value);
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <Button onClick={() => setRenaming(true)}>{name}</Button>
        )}
      </section>
      <section aria-label="浮层">
        <Button id="open-modal" onClick={() => setModal(true)}>
          打开弹窗
        </Button>
        <Button ref={anchor} onClick={() => setPopover(true)}>
          打开浮层
        </Button>
        <Popover
          open={popover}
          anchorRef={anchor}
          closeOnOutsideClick
          closeOnEscape
          onClose={() => setPopover(false)}
        >
          <div className="popup-content">
            <span>父浮层</span>
            <Select aria-label="浮层状态" value={status} onChange={setStatus} options={options} />
          </div>
        </Popover>
        <Modal
          open={modal}
          title="编辑属性"
          onClose={() => setModal(false)}
          initialFocusRef={focus}
          footer={<Button onClick={() => setModal(false)}>保存属性</Button>}
        >
          <Input ref={focus} aria-label="弹窗名称" />
          <Select aria-label="弹窗状态" value={status} onChange={setStatus} options={options} />
        </Modal>
        <Button
          onClick={async () => {
            if (await dialog.confirm('确认保存', '保存这次修改？')) toast.success('已保存', 0);
          }}
        >
          确认与通知
        </Button>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <DialogProvider>
      <Fixture />
    </DialogProvider>
  </ToastProvider>
);
