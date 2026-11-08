# dsh-power-monitor

DeepSeek Harness 的实时功耗与电费插件：在左侧边栏账号行上方显示当前整机功耗、今日/本月用电量与电费估算，并为模型提供 `power_status` 工具。

## 能测什么，怎么估

| 部件 | 来源 | 精度 |
| --- | --- | --- |
| NVIDIA GPU | `nvidia-smi`（显卡板载功耗） | 实测 |
| CPU / GPU | [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) 的 Web 服务器（默认端口 8085） | 实测 |
| CPU（无 LHM 时） | 使用率 × 配置的 TDP 模型：`空闲功耗 + (TDP − 空闲功耗) × 负载` | 估算 |
| 主板、内存、硬盘、风扇 | 配置项 `baseWatts` | 估算 |
| 电源转换损耗 | 各部件直流功耗 ÷ `psuEfficiency` 得到墙插交流功耗 | 估算 |

数据全部在本机读取：`nvidia-smi` 是本地进程，LibreHardwareMonitor 只访问 `127.0.0.1:8085`，插件不联网。

## 界面

- 侧栏展开时，账号行（头像 / 用户名 / 设置）正上方的一张实时功耗卡，占满侧栏宽度：`⚡ 86.2 W` + 今日电费 + 今日电量/本月电费 + 最近几分钟的曲线。
- 点击卡片展开详情：CPU / GPU / 其他硬件分项与占比、今日/本月/本次运行用电量与电费、数据来源、校准输入框（电价、CPU TDP、其他硬件功耗）。
- 侧栏收起时，卡片自动变成 40px 宽的紧凑版本（闪电图标 + 瓦数），鼠标悬停可看完整读数。
- 展开后标题栏右侧有 `EN / 中` 按钮，单独切换这张卡片的语言；未手动切换时跟随应用语言，手动选择保存在浏览器本地。
- 中英文随界面语言切换。

## 校准值

面板中修改的三个值会立即生效并保存到本机状态文件，不会重启插件：

- Windows：`%LOCALAPPDATA%\dsh-power-monitor\state.json`
- macOS：`~/Library/Application Support/dsh-power-monitor/state.json`
- Linux：`$XDG_STATE_HOME/dsh-power-monitor/state.json`（默认 `~/.local/state/...`）

该文件同时保存最近约两个月的每日瓦时（Wh）累计，所以今日/本月电费在 DSH 重启后仍然连续。

## 配置（`cordis.patch.yml`）

安装时的配置只作为**首次运行默认值**；面板里改过的电价、CPU TDP、其他硬件会覆盖配置文件中的同名值。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `tariff` | `0.56` | 电价，每 kWh |
| `currency` | `CNY` | `CNY` / `USD` / `EUR` / `GBP` / `JPY` |
| `cpuTdp` | `125` | CPU 功耗上限（W），用于估算 |
| `cpuIdle` | `12` | CPU 空闲功耗（W） |
| `baseWatts` | `30` | CPU/GPU 之外的基础功耗（W） |
| `psuEfficiency` | `0.9` | 电源转换效率，用于换算墙插功耗 |
| `intervalMs` | `2500` | 采样间隔（毫秒） |
| `enableNvidia` | `true` | 是否调用 `nvidia-smi` |
| `nvidiaSmiPath` | `''` | `nvidia-smi` 不在 PATH 时手动指定 |
| `enableLhm` | `true` | 是否读取 LibreHardwareMonitor |
| `lhmUrl` | `http://127.0.0.1:8085/data.json` | LHM Web 服务器地址 |
| `stateFile` | `''` | 覆盖状态文件路径 |
| `historyPoints` | `90` | 迷你曲线保留的点数 |

## 模型工具

`power_status`（无参数）返回当前墙插功耗、分项来源、今日/本月/本次运行电量与电费。适合让模型回答「现在电脑多少瓦」「今天电费多少」。

## 已知限制

- 没有 LHM 时 CPU 只能按负载与 TDP 估算；虚拟机、降压/超频或功耗墙会带来偏差。
- 集显、AMD GPU 的功耗依赖 LHM 是否暴露对应传感器。
- 电费按单一电价计算；阶梯电价、峰谷电价请按平均值填写。
- 采样期间会每 `intervalMs` 启动一次 `nvidia-smi`；不希望有进程开销可设 `enableNvidia: false`。