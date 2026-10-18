# 面向对象设计模式与 Java/C++ 实现案例

> 本专题专为软考下午C++ 与 Java 面向对象程序设计选答题（15 分二选一选做题）定制。考生拿到题目后，可直接对照设问类型（识别模式、填继承接口、填构造创建、填委托多态、静态语法检查），定位至对应作答卡快速展开推理作答。

---

## 1. 设计模式题型识别与考场通用破题流程

### 1.1 试题识别与题面结构
- **试题位置**：C++ 或 Java 选答题，以卷面语言与选答说明为准，满分 15 分，考题内容同构，仅编程语言与语法不同。
- **题面三件套**：
  1. **设计意图与业务背景说明**：描述系统遇到的扩展性挑战（如避免类爆炸、解耦算法族、动态通知各界面、统一树形结构、撤销历史恢复）；
  2. **设计模式类图框架**：给出涉及的接口、抽象类、具体实现类、上下文类之间的继承（实线空心三角）、实现（虚线空心三角）与聚合关联（实线带箭头）连线；
  3. **挖空的源码框架**：代码空位数量与分值以卷面为准，要求补充类继承关系、构造器、多态委托调用或对象创建。

### 1.2 考场四步快速解题流水线
```text
第 1 步：读意图抓信号，判定模式名称 → 查职责三问与考场速查表，先与本章 19 种教学模式的意图和职责核对，遇到未列模式再按题设推理
  ↓
第 2 步：对照类图角色，定位各空职责 → 明确挖空位置是抽象构件、具体实现、还是环境上下文
  ↓
第 3 步：按空位分类，精准填入代码 → 继承填 extends/:public，构造填 super/初始化列表，多态填委托调用
  ↓
第 4 步：六步静态检查，消灭语法失误 → 排查单继承、分号、类型转换、C++ 指针箭头 -> 与解引用
```

---

## 2. 设计模式核心作答卡（动作与空位驱动）

---

### 作答卡 DP-01：识别设计模式

- **【题型识别】**：常见设问：“代码中采用了 (n) 设计模式” / “类图展现了哪种经典设计模式？”（通常 2～3 分）。
- **【目标产出】**：GoF 经典设计模式标准中英文名称（如“桥接模式 (Bridge)”、“策略模式 (Strategy)”）。
- **【题干取证】**：
  - 阅读题干开篇的“设计意图说明”；
  - 观察类图中的继承与组合结构。
- **【推理步骤（模式识别三问法）】**：
  1. **第一问：系统面临的核心变化点是什么？**
     - 两个独立变化的维度（如操作系统平台 × 图像格式） → **桥接模式 (Bridge)**；
     - 算法规则需频繁切换与扩展（如打折、计费、排序） → **策略模式 (Strategy)**；
     - 对象的行为随生命周期状态演进而动态变身 → **状态模式 (State)**；
     - 一对多状态变动联动通知（如数据更新多屏同步） → **观察者模式 (Observer)**；
     - 部分与整体的树形层次，叶子与容器一致对待 → **组合模式 (Composite)**；
  2. **第二问：哪个对象集中协调交互，还是对外提供统一高层门面？**
     - 多个平级同事对象互相调用、关系混乱，需要集中协同 → **中介者模式 (Mediator)**；
     - 封装子系统复杂接口，对外提供单一前台接待入口 → **外观模式 (Facade)**；
  3. **第三问：如何创建对象或增强对象？**
     - 成套产品族切换（如换数据库引擎、换UI主题） → **抽象工厂模式 (Abstract Factory)**；
     - 复杂对象分步装配（服务员调度厨师组装套餐） → **生成器模式 (Builder)**；
     - 通过既有对象快速深浅克隆复制新对象 → **原型模式 (Prototype)**；
     - 动态透明地给对象增添额外职责（加头加尾发票） → **装饰模式 (Decorator)**；
     - 已有接口不兼容但需复用老组件 → **适配器模式 (Adapter)**；
     - 撤销与历史状态快照保存 → **备忘录模式 (Memento)**。
- **【答案形态】**：标准中英文名称（如 `桥接模式` 或 `Bridge 模式`）。
- **【知识依赖】**：[19 种设计模式考场速记表](#51-19-种教学模式与判定依据)。

---

### 作答卡 DP-02：识别模式角色

- **【题型识别】**：设问：“指出各抽象类/接口与实现类在模式中扮演的角色”。
- **【目标产出】**：标准模式角色名称。
- **【核心角色对照表】**：
  - **适配器模式**：`Target`（目标接口）、`Adaptee`（被适配者）、`Adapter`（适配器）；
  - **观察者模式**：`Subject`（抽象主题）、`ConcreteSubject`（具体目标）、`Observer`（抽象观察者）、`ConcreteObserver`（具体观察者）；
  - **策略模式**：`Strategy`（抽象策略接口）、`ConcreteStrategy`（具体策略实现）、`Context`（环境上下文）；
  - **备忘录模式**：`Originator`（原发器/发起人）、`Memento`（备忘录/快照）、`Caretaker`（负责人/管理者）；
  - **组合模式**：`Component`（抽象构件）、`Leaf`（叶子构件）、`Composite`（容器构件）；
  - **生成器模式**：`Builder`（抽象建造者）、`ConcreteBuilder`（具体建造者）、`Director`（指挥者）、`Product`（产品）。
- **【知识依赖】**：[各设计模式标准角色体系](#52-c-与-java-完整教学实现库)。

---

### 作答卡 DP-03：面向对象继承与接口语法填空

- **【题型识别】**：空位位于类声明头部、方法重写头部或纯虚函数声明处。
- **【目标产出】**：继承/实现关键字与父类/接口名称。
- **【推理步骤】**：
  1. **Java 语言规范**：
     - 继承父类：`extends BaseClass`（Java 严格单继承，只能继承一个类）；
     - 实现接口：`implements InterfaceA, InterfaceB`（可同时实现多个接口）；
     - 抽象方法：`public abstract void doAction();`；
  2. **C++ 语言规范**：
     - 公有继承：`: public BaseClass`；
     - 纯虚函数声明：`virtual void doAction() = 0;`；
     - 虚析构函数：`virtual ~BaseClass() {}`。
- **【答案形态】**：
  - Java: `extends MenuComponent`，`implements Cloneable`；
  - C++: `: public Item`，`virtual void print() = 0`。
- **【知识依赖】**：[双语语法静态检查规范](#53-双语语法静态检查六步自检法则)。
- **【易错与自检】**：
  - *陷阱*：Java 错写 `extends A, B`；C++ 继承漏写 `public` 导致变成私有继承。

---

### 作答卡 DP-04：面向对象多态委托与方法调用代码填空动作卡

- **【题型识别】**：空位位于业务执行方法体内部、状态/策略转换处或容器批量分派点，要求将业务请求委托给聚合持有的成员对象（通常 2.5～3 分/空）。
- **【目标产出】**：精准的方法调用表达式（含被调对象、方法名、传递参数）。
- **【题干取证】**：
  - 查看类图中的聚合/组合实线箭头，锁定当前类持有的**被委托成员变量名**（如 `protected Strategy strategy;` 或 `private State state;`）；
  - 查看被委托接口/抽象类中声明的**多态方法名**及形参列表；
  - 检查当前上下文是否需要将自身传递过去（如 `this`）。
- **【推理步骤（5 大经典空位类型推导流水线）】**：
  1. **类型 1：基类与接口继承/实现空位**：
     - 若后跟普通类/抽象类：Java 填 `extends BaseClass`；C++ 填 `: public BaseClass`；
     - 若后跟接口：Java 填 `implements InterfaceName`；C++ 仍为 `: public InterfaceName`；
  2. **类型 2：抽象方法与虚函数声明空位**：
     - 位于接口或抽象基类中：Java 填 `public abstract 返回类型 方法名(形参);`；C++ 填 `virtual 返回类型 方法名(形参) = 0;`；
  3. **类型 3：构造依赖注入与父类初始化空位**：
     - Java 子类构造首行调用父类构造：`super(参数);` 或保存依赖 `this.strategy = strategy;`；
     - C++ 子类构造必须通过初始化列表传递基类参数：`: BaseClass(参数), member(参数)`；
  4. **类型 4：状态/策略动态切换与环境注入空位**：
     - 状态模式中子状态类触发环境状态流转：`context.setState(new ConcreteState());` 或 `context.setState(this);`；
     - 策略/桥接中装配具体实现算法：`context.setStrategy(strategy);`；
  5. **类型 5：多态集合遍历与批量分派调用空位**：
     - 组合模式与观察者模式中向所有子节点/观察者广播事件：
       - Java: `for (Observer o : observers) { o.update(state); }` 或 `for (Component c : children) { c.operation(); }`；
       - C++: `for (auto it = observers.begin(); it != observers.end(); ++it) { (*it)->update(state); }`。
- **【答案形态】**：
  ```text
  Java 典型答案: strategy.algorithmInterface(data);
  C++ 典型答案: strategy->algorithmInterface(data);
  双向传递示例: visitor.visit(this); 或 imp->doPaint(m);
  ```
- **【知识依赖】**：[19 种设计模式双语教学实现库](#52-c-与-java-完整教学实现库)。
- **【易错与自检】**：
  - *陷阱*：Java 与 C++ 的解引用符号搞混（Java 均用点号 `.`；C++ 指针变量必须用箭头 `->`）；
  - *自检*：调用的方法名是否与类图中该接口定义的方法名拼写、大小写完全一致？

---

### 作答卡 DP-05：C++ 与 Java 双语核心填空语法对照速查卡

- **【题型识别】**：面向C++ 与 Java 两种语言共用同一套模式语义时的语言级代码填空转换。
- **【目标产出】**：严格遵循对应语言编译规范的代码片段。
- **【双语核心语法对应大表】**：

| 面向对象语言机制 | Java 代码填空标准写法 | C++ 代码填空标准写法 | 考场易错陷阱与自检 |
|---|---|---|---|
| **类继承** | `class B extends A` | `class B : public A` | C++ 漏写 `public` 将变成私有继承无法多态 |
| **接口实现** | `class B implements Inter` | `class B : public Inter` | Java 接口用 `implements`，C++ 无单独 interface 关键字 |
| **纯虚/抽象方法声明**| `abstract void action();` | `virtual void action() = 0;` | C++ 纯虚函数尾部必带 `= 0;`，Java 带 `abstract` |
| **子类调用父类构造**| `super(name);`（函数首行） | `: Base(name)`（位于函数头初始化列表）| Java 必须在构造函数第一行，C++ 必须在冒号后 |
| **动态对象创建** | `new ConcreteProduct()` | `new ConcreteProduct()` | C++ `new` 返回指针类型（如 `Product* p = new ...`） |
| **当前对象传参** | `visitor.visit(this);` | `visitor->visit(this);` | 访问者/备忘录模式中常将当前实例指针 `this` 传出 |
| **成员指针/引用调用**| `member.operation();` | `member->operation();` | C++ 只要是指针类型，方法调用必用箭头 `->` |
| **集合容器添加元素**| `children.add(component);` | `children.push_back(component);` | Java 用 `add`，C++ `vector`/`list` 用 `push_back` |
| **集合多态广播遍历**| `for (Item item : list) { item.op(); }` | `for (auto it : list) { it->op(); }` | C++ 迭代器指针注意解引用 |
| **常量与空指针** | `null` | `NULL` 或 `nullptr` | 大小写差异 |

- **【知识依赖】**：[双语语法静态检查六步自检法则](#53-双语语法静态检查六步自检法则)。

---

### 作答卡 DP-06：双语语法静态检查六步自检

- **【题型识别】**：完成填空后的最终交卷自检动作。
- **【静态检查六步检查表】**：
  1. **单/多继承检查**：Java `extends` 后面是否只有一个类名？
  2. **可见性与签名一致性**：重写的方法名、返回类型与参数列表是否与父类完全一致？访问权限没有被缩小？
  3. **构造链传递**：父类缺少无参构造函数时，子类是否显式调用了 `super(...)`？
  4. **指针箭头与点号**：C++ 指针变量是否严格使用了 `->` 而非 `.`？
  5. **语句末尾分号**：Java 和 C++ 的普通执行语句末尾是否均带上了分号 `;`？
  6. **类型强制转换**：Java 的 `clone()` 或容器返回 `Object` 时，是否执行了 `(TargetType)` 强制转换？
- **【知识依赖】**：[双语语法静态检查六步自检法则](#53-双语语法静态检查六步自检法则)。

---

## 3. 典型真题全链路演练与真题锚点

以已验收真题 2024 年下半年试题二（桥接模式 Java 实现）（请在历年真题页面查看） 为例，演示从题面到标准答案的全流程：

### 3.1 题面关键信息提炼
- **业务背景**：图像预览程序要求查看 BMP、JPEG 和 GIF 三种格式的文件，且能够在 Windows 和 Linux 两种操作系统上运行。为支持扩展并减少子类数目，系统采用**桥接（Bridge）模式**进行设计。
- **类图与代码骨架**：
  - 左侧为图像抽象化角色 `abstract class Image`（持有 `protected Implementor imp;`，提供 `setImp(Implementor imp)` 与抽象方法 `parseFile(String fileName)`），其子类为 `BMPImage`、`GIFImage` 和 `JPEGImage`；
  - 右侧为实现化角色 `abstract class Implementor`，其子类为操作系统具体绘制实现 `WinImp` 与 `LinuxImp`（均实现 `public void doPaint(Matrix m)`）；
  - `Image` 内部聚合了 `Implementor` 引用。

### 3.2 逐小问推导演练
- **空 (1)：抽象实现基类中的行为声明**：
  - **取证**：类 `Implementor` 是操作系统实现抽象基类，其派生子类 `WinImp` 和 `LinuxImp` 均实现了 `public void doPaint(Matrix m)` 方法；空 (1) 位于 `abstract class Implementor` 内部声明处，注释标注“显示像素矩阵 m”。
  - **推理**：作为抽象基类，必须声明公共绘制方法供多态调用。在 Java 中抽象类声明抽象方法需带 `abstract` 修饰符，且方法签名与参数类型必须与子类实现保持一致。
  - **答案**：`abstract void doPaint(Matrix m)`（套用 [作答卡 DP-03](#作答卡-dp-03面向对象继承与接口语法填空)）。
- **空 (2)：多态委托底层平台绘制像素矩阵**：
  - **取证**：在具体图像类 `GIFImage` 的 `parseFile(String fileName)` 方法中，已解析获得像素矩阵对象 `m`，后接注释“显示像素矩阵 m”。
  - **推理**：父类 `Image` 持有实现化角色引用 `protected Implementor imp`。根据桥接模式思想，具体格式类不直接调用平台 API，而是委托持有的桥接接口进行绘制。
  - **答案**：`imp.doPaint(m)`（套用 [作答卡 DP-04](#作答卡-dp-04面向对象多态委托与方法调用代码填空动作卡)）。
- **空 (3) 与空 (4)：根据客户端需求实例化具体图像与平台实现对象**：
  - **取证**：`main` 方法注释明确指定“在 Linux 操作系统上查看 demo.gif 图像文件”。
  - **推理**：
    - 图像格式为 GIF，对应抽象子类实例化：空 (3) 填 `new GIFImage()`；
    - 操作系统为 Linux，对应具体实现子类实例化：空 (4) 填 `new LinuxImp()`。
  - **答案**：
    - (3) `new GIFImage()`
    - (4) `new LinuxImp()`（核对构造器签名与下文 6.3 桥接装配示例）。
- **空 (5)：依赖注入装配桥接关系**：
  - **取证**：已创建图像对象 `image` 与平台实现对象 `imageImp`，随后执行 `image.parseFile("demo.gif");`。
  - **推理**：调用解析与绘制前，必须将具体操作系统实现注入到图像抽象对象中。基类 `Image` 提供了 Setter 注入方法 `public void setImp(Implementor imp)`。
  - **答案**：`image.setImp(imageImp)`（套用 [作答卡 DP-04](#作答卡-dp-04面向对象多态委托与方法调用代码填空动作卡)）。

### 3.3 统考最新实战演练与真题锚点补充

#### 案例 A：2024 年上半年统考真题——状态模式（State）银行账户状态转移 Java 实现
- **业务场景**：银行账户根据余额处于不同状态（GreenState 正常、YellowState 欠费、RedState 冻结）。存取款操作会导致余额变动，并触发账户状态的流转。
- **核心角色与解题推导**：
  1. **环境类 (Context)**：`Account` 类持有 `private State state;` 引用，存取款时直接委托当前状态 `state.deposit(amount)` 或 `state.withdraw(amount)`；
  2. **抽象状态角色 (State)**：声明公共操作 `deposit(double amount)`、`withdraw(double amount)` 与检查状态方法 `checkState()`；
  3. **具体状态角色 (ConcreteState)**：
     - 各状态类持有所属环境引用 `protected Account acc;`；
     - 每次余额改变后，调用 `checkState()` 判断余额阈值（`balance >= 0` 转 GreenState，`-1000 <= balance < 0` 转 YellowState，`balance < -1000` 转 RedState），通过 `acc.setState(new ConcreteState(this))` 动态替换环境持有的状态对象。

#### 案例 B：2023 年下半年统考真题——命令模式（Command）公告栏系统 Java 实现
- **业务场景**：系统通过图形界面发布或删除公告信息。为解耦菜单/按钮与具体公告板后台操作，引入命令模式。
- **核心角色与解题推导**：
  1. **命令接口 (Command)**：声明 `public void execute();` 执行入口；
  2. **具体命令类 (ConcreteCommand)**：`PostNoticeCommand` 与 `DeleteNoticeCommand`，内部聚合了真正执行业务的接收者 `NoticeBoard` 引用，在 `execute()` 中调用 `noticeBoard.post(msg)` 或 `noticeBoard.delete(id)`；
  3. **调用者 (Invoker)**：界面按钮或菜单，持有抽象 `Command` 接口对象，在用户点击时触发 `command.execute()`，彻底与具体公告板解耦。

---

## 4. 易错陷阱与交卷自检清单

交卷前花 2 分钟逐项对照以下清单自检：

- [ ] **分号遗漏排查**：检查所填代码行末尾是否缺少了必需的分号 `;`？
- [ ] **指针符号核对**：C++ 指针调用是否均写成了箭头 `->`？纯虚函数是否写成了 `= 0;`？
- [ ] **构造函数名称**：构造函数名是否与类名拼写完全一致且没有返回值类型？
- [ ] **克隆类型强转**：Java 调用 `clone()` 后，是否加了具体类型的括号向下强转？
- [ ] **角色颠倒自检**：委托调用时，是委托给持有的依赖对象，而不是将上下文反向操控外部对象？

---

## 5. 支撑知识详解（19 种设计模式双语教学实现库）

### 5.1 19 种教学模式与判定依据

| 模式 | 判定与填空线索 |
|---|---|
| 桥接（Bridge） | 两个独立变化维度；抽象持有实现接口，先装配再委托。 |
| 组合（Composite） | 叶子与容器共享接口；容器保存抽象构件并递归分派。 |
| 策略（Strategy） | 环境类保存可替换策略；构造/Setter 注入，业务入口委托。 |
| 状态（State） | 行为取决于当前状态；状态对象通过 Context 改变后续行为。 |
| 观察者（Observer） | 目标维护观察者集合，状态改变后通知全部订阅者。 |
| 适配器（Adapter） | 目标接口与旧接口不兼容；适配器持有旧对象并转换调用。 |
| 装饰（Decorator） | 装饰器也实现构件接口，委托原构件后增加职责。 |
| 命令（Command） | 调用者持有命令接口；具体命令保存接收者并调用其业务。 |
| 访问者（Visitor） | accept 接收访问者，内部 visit(this) 完成双分派。 |
| 模板方法（Template） | 父类固定算法流程，抽象步骤由子类实现。 |
| 抽象工厂（Factory） | 同一工厂创建兼容的产品族，客户端依赖抽象产品。 |
| 生成器（Builder） | 指挥者控制步骤，建造者保存并返回产品。 |
| 原型（Prototype） | 通过多态 clone 复制对象；验证副本与原型不共享可变状态。 |
| 备忘录（Memento） | 发起人保存/恢复状态，管理者保存快照而不修改其内容。 |
| 中介者（Mediator） | 同事只知道中介者，由中介者决定通知对象。 |
| 外观（Facade） | 门面串联子系统调用；客户端只认识统一入口。 |
| 享元（Flyweight） | 工厂按内部状态复用对象，外部状态在调用时传入。 |
| 责任链（Chain） | 请求沿后继传递；当前处理者不能处理才交给下一位。 |
| 迭代器（Iterator） | 聚合对象提供迭代入口；先判断终点再读取/推进。 |

### 5.2 C++ 与 Java 完整教学实现库

以下 19 组是原创教学模型，用于训练代码补全与运行追踪，不冒称新增历年真题。每个代码块是独立程序，不能把多个同名教学类型直接拼接。Java 使用各段指定文件名；C++ 使用 C++17。可用 `javac 文件名.java`、`java 类名` 或 `c++ -std=c++17 文件名.cpp -o demo` 编译运行。

C++ 示例中引用与裸指针用于非拥有关系，依赖对象均比使用者活得久；拥有对象的工厂/克隆使用智能指针。不能由“有指针”推断负责 delete，也不能把点号与箭头机械互换。经基类指针销毁派生对象时，基类需有可访问的虚析构；Java 回收普通内存不代表外部资源立即关闭。

每组必须走通“抽象接口 → 成员类型 → 构造/装配 → 委托/递归调用 → 客户端 → 结果”。填空答案只填题面缺少的部分：已有 public、分号或声明前缀时不要重复。

#### 1. 桥接（Bridge）

两个独立变化维度；抽象持有实现接口，先装配再委托。

Java 完整教学程序（保存为 BridgeDemo.java）：

```java
import java.util.*;
public class BridgeDemo {
    interface Painter {
        String paint(String shape);
    }
    static class Screen implements Painter {
        public String paint(String s) {
            return "screen:"+s;
        }
    }
    static abstract class Shape {
        protected final Painter painter;
        Shape(Painter p) {
            painter=p;
        }
        abstract String draw();
    }
    static class Circle extends Shape {
        Circle(Painter p) {
            super(p);
        }
        String draw() {
            return painter.paint("circle");
        }
    }
    static String demo() {
        Shape s=new Circle(new Screen());
        return s.draw();
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("screen:circle"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Bridge {
    struct Painter {
        virtual string paint(const string&)=0;
        virtual ~Painter()=default;
    };
    struct Screen:Painter {
        string paint(const string& s) override {
            return "screen:"+s;
        }
    };
    struct Shape {
        Painter& painter;
        explicit Shape(Painter& p):painter(p) {
        }
        virtual string draw()=0;
        virtual ~Shape()=default;
    };
    struct Circle:Shape {
        explicit Circle(Painter& p):Shape(p) {
        }
        string draw() override {
            return painter.paint("circle");
        }
    };
    string demo() {
        Screen p;
        Circle c(p);
        Shape& s=c;
        return s.draw();
    }
}
int main() {
    string actual=Bridge::demo();
    assert(actual=="screen:circle");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`screen:circle`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 2. 组合（Composite）

叶子与容器共享接口；容器保存抽象构件并递归分派。

Java 完整教学程序（保存为 CompositeDemo.java）：

```java
import java.util.*;
public class CompositeDemo {
    interface Node {
        String draw();
    }
    static class Leaf implements Node {
        public String draw() {
            return "L";
        }
    }
    static class Group implements Node {
        final List<Node> children=new ArrayList<>();
        void add(Node n) {
            children.add(n);
        }
        void remove(Node n) {
            children.remove(n);
        }
        public String draw() {
            StringBuilder b=new StringBuilder();
            for(Node n:children)b.append(n.draw());
            return b.toString();
        }
    }
    static String demo() {
        Group root=new Group(),sub=new Group();
        Leaf leaf=new Leaf();
        sub.add(leaf);
        root.add(sub);
        root.add(new Leaf());
        if(!root.draw().equals("LL"))throw new AssertionError();
        sub.remove(leaf);
        return root.draw();
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("L"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Composite {
    struct Node {
        virtual string draw()=0;
        virtual ~Node()=default;
    };
    struct Leaf:Node {
        string draw() override {
            return "L";
        }
    };
    struct Group:Node {
        vector<Node*> children;
        void add(Node& n) {
            children.push_back(&n);
        }
        void remove(Node& n) {
            children.erase(std::remove(children.begin(),children.end(),&n),children.end());
        }
        string draw() override {
            string s;
            for(Node* n:children)s+=n->draw();
            return s;
        }
    };
    string demo() {
        Group root,sub;
        Leaf a,b;
        sub.add(a);
        root.add(sub);
        root.add(b);
        assert(root.draw()=="LL");
        sub.remove(a);
        return root.draw();
    }
}
int main() {
    string actual=Composite::demo();
    assert(actual=="L");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`L`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 3. 策略（Strategy）

环境类保存可替换策略；构造/Setter 注入，业务入口委托。

Java 完整教学程序（保存为 StrategyDemo.java）：

```java
import java.util.*;
public class StrategyDemo {
    interface Pay {
        int cost(int amount);
    }
    static class Half implements Pay {
        public int cost(int x) {
            return x/2;
        }
    }
    static class Full implements Pay {
        public int cost(int x) {
            return x;
        }
    }
    static class Order {
        private Pay pay;
        Order(Pay p) {
            pay=p;
        }
        void setPay(Pay p) {
            pay=p;
        }
        int checkout(int x) {
            return pay.cost(x);
        }
    }
    static String demo() {
        Order o=new Order(new Half());
        if(o.checkout(10)!=5)throw new AssertionError();
        o.setPay(new Full());
        return ""+o.checkout(10);
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("10"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Strategy {
    struct Pay {
        virtual int cost(int)=0;
        virtual ~Pay()=default;
    };
    struct Half:Pay {
        int cost(int x) override {
            return x/2;
        }
    };
    struct Full:Pay {
        int cost(int x) override {
            return x;
        }
    };
    struct Order {
        Pay* pay;
        explicit Order(Pay& p):pay(&p) {
        }
        void setPay(Pay& p) {
            pay=&p;
        }
        int checkout(int x) {
            return pay->cost(x);
        }
    };
    string demo() {
        Half h;
        Full f;
        Order o(h);
        assert(o.checkout(10)==5);
        o.setPay(f);
        return to_string(o.checkout(10));
    }
}
int main() {
    string actual=Strategy::demo();
    assert(actual=="10");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`10`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 4. 状态（State）

行为取决于当前状态；状态对象通过 Context 改变后续行为。

Java 完整教学程序（保存为 StateDemo.java）：

```java
import java.util.*;
public class StateDemo {
    interface State {
        String act(Context c);
    }
    static class Ready implements State {
        public String act(Context c) {
            c.setState(new Done());
            return "ready";
        }
    }
    static class Done implements State {
        public String act(Context c) {
            return "done";
        }
    }
    static class Context {
        private State state=new Ready();
        void setState(State s) {
            state=s;
        }
        String act() {
            return state.act(this);
        }
    }
    static String demo() {
        Context c=new Context();
        return c.act()+","+c.act();
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("ready,done"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace State {
    struct Context;
    struct State {
        virtual string act(Context&)=0;
        virtual ~State()=default;
    };
    struct Done:State {
        string act(Context&) override {
            return "done";
        }
    };
    struct Ready:State {
        State& next;
        explicit Ready(State& n):next(n) {
        }
        string act(Context&) override;
    };
    struct Context {
        State* state;
        explicit Context(State& s):state(&s) {
        }
        void setState(State& s) {
            state=&s;
        }
        string act() {
            return state->act(*this);
        }
    };
    string Ready::act(Context& c) {
        c.setState(next);
        return "ready";
    }
    string demo() {
        Done d;
        Ready r(d);
        Context c(r);
        string first=c.act();
        return first+","+c.act();
    }
}
int main() {
    string actual=State::demo();
    assert(actual=="ready,done");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`ready,done`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 5. 观察者（Observer）

目标维护观察者集合，状态改变后通知全部订阅者。

Java 完整教学程序（保存为 ObserverDemo.java）：

```java
import java.util.*;
public class ObserverDemo {
    interface Observer {
        void update(int n);
    }
    static class View implements Observer {
        int value;
        public void update(int n) {
            value=n;
        }
    }
    static class Subject {
        final List<Observer> observers=new ArrayList<>();
        void attach(Observer o) {
            observers.add(o);
        }
        void detach(Observer o) {
            observers.remove(o);
        }
        void change(int n) {
            for(Observer o:observers)o.update(n);
        }
    }
    static String demo() {
        Subject s=new Subject();
        View a=new View(),b=new View();
        s.attach(a);
        s.attach(b);
        s.change(3);
        s.detach(b);
        s.change(4);
        return a.value+","+b.value;
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("4,3"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Observer {
    struct Observer {
        virtual void update(int)=0;
        virtual ~Observer()=default;
    };
    struct View:Observer {
        int value=0;
        void update(int n) override {
            value=n;
        }
    };
    struct Subject {
        vector<Observer*> observers;
        void attach(Observer& o) {
            observers.push_back(&o);
        }
        void detach(Observer& o) {
            observers.erase(std::remove(observers.begin(),observers.end(),&o),observers.end());
        }
        void change(int n) {
            for(Observer* o:observers)o->update(n);
        }
    };
    string demo() {
        Subject s;
        View a,b;
        s.attach(a);
        s.attach(b);
        s.change(3);
        s.detach(b);
        s.change(4);
        return to_string(a.value)+","+to_string(b.value);
    }
}
int main() {
    string actual=Observer::demo();
    assert(actual=="4,3");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`4,3`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 6. 适配器（Adapter）

目标接口与旧接口不兼容；适配器持有旧对象并转换调用。

Java 完整教学程序（保存为 AdapterDemo.java）：

```java
import java.util.*;
public class AdapterDemo {
    interface Target {
        String request();
    }
    static class Legacy {
        String oldRequest() {
            return "legacy";
        }
    }
    static class Adapter implements Target {
        private final Legacy legacy;
        Adapter(Legacy l) {
            legacy=l;
        }
        public String request() {
            return legacy.oldRequest();
        }
    }
    static String demo() {
        Target t=new Adapter(new Legacy());
        return t.request();
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("legacy"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Adapter {
    struct Target {
        virtual string request()=0;
        virtual ~Target()=default;
    };
    struct Legacy {
        string oldRequest() {
            return "legacy";
        }
    };
    struct Adapter:Target {
        Legacy& legacy;
        explicit Adapter(Legacy& l):legacy(l) {
        }
        string request() override {
            return legacy.oldRequest();
        }
    };
    string demo() {
        Legacy l;
        Adapter a(l);
        Target& t=a;
        return t.request();
    }
}
int main() {
    string actual=Adapter::demo();
    assert(actual=="legacy");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`legacy`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 7. 装饰（Decorator）

装饰器也实现构件接口，委托原构件后增加职责。

Java 完整教学程序（保存为 DecoratorDemo.java）：

```java
import java.util.*;
public class DecoratorDemo {
    interface Component {
        String text();
    }
    static class Plain implements Component {
        public String text() {
            return "body";
        }
    }
    static class Border implements Component {
        private final Component inner;
        Border(Component c) {
            inner=c;
        }
        public String text() {
            return "["+inner.text()+"]";
        }
    }
    static String demo() {
        Component c=new Border(new Border(new Plain()));
        return c.text();
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("[[body]]"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Decorator {
    struct Component {
        virtual string text()=0;
        virtual ~Component()=default;
    };
    struct Plain:Component {
        string text() override {
            return "body";
        }
    };
    struct Border:Component {
        Component& inner;
        explicit Border(Component& c):inner(c) {
        }
        string text() override {
            return "["+inner.text()+"]";
        }
    };
    string demo() {
        Plain p;
        Border a(p);
        Border b(static_cast<Component&>(a));
        Component& c=b;
        return c.text();
    }
}
int main() {
    string actual=Decorator::demo();
    assert(actual=="[[body]]");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`[[body]]`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 8. 命令（Command）

调用者持有命令接口；具体命令保存接收者并调用其业务。

Java 完整教学程序（保存为 CommandDemo.java）：

```java
import java.util.*;
public class CommandDemo {
    static class Receiver {
        String open() {
            return "open";
        }
    }
    interface Command {
        String execute();
    }
    static class Open implements Command {
        final Receiver receiver;
        Open(Receiver r) {
            receiver=r;
        }
        public String execute() {
            return receiver.open();
        }
    }
    static class Button {
        final Command command;
        Button(Command c) {
            command=c;
        }
        String click() {
            return command.execute();
        }
    }
    static String demo() {
        return new Button(new Open(new Receiver())).click();
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("open"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Command {
    struct Receiver {
        string open() {
            return "open";
        }
    };
    struct Command {
        virtual string execute()=0;
        virtual ~Command()=default;
    };
    struct Open:Command {
        Receiver& receiver;
        explicit Open(Receiver& r):receiver(r) {
        }
        string execute() override {
            return receiver.open();
        }
    };
    struct Button {
        Command& command;
        explicit Button(Command& c):command(c) {
        }
        string click() {
            return command.execute();
        }
    };
    string demo() {
        Receiver r;
        Open c(r);
        Button b(c);
        return b.click();
    }
}
int main() {
    string actual=Command::demo();
    assert(actual=="open");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`open`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 9. 访问者（Visitor）

accept 接收访问者，内部 visit(this) 完成双分派。

Java 完整教学程序（保存为 VisitorDemo.java）：

```java
import java.util.*;
public class VisitorDemo {
    interface Visitor {
        String visit(Book b);
        String visit(Food f);
    }
    interface Item {
        String accept(Visitor v);
    }
    static class Book implements Item {
        public String accept(Visitor v) {
            return v.visit(this);
        }
    }
    static class Food implements Item {
        public String accept(Visitor v) {
            return v.visit(this);
        }
    }
    static class Cashier implements Visitor {
        public String visit(Book b) {
            return "B";
        }
        public String visit(Food f) {
            return "F";
        }
    }
    static String demo() {
        Visitor v=new Cashier();
        Item a=new Book(),b=new Food();
        return a.accept(v)+b.accept(v);
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("BF"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Visitor {
    struct Book;
    struct Food;
    struct Visitor {
        virtual string visit(Book&)=0;
        virtual string visit(Food&)=0;
        virtual ~Visitor()=default;
    };
    struct Item {
        virtual string accept(Visitor&)=0;
        virtual ~Item()=default;
    };
    struct Book:Item {
        string accept(Visitor& v) override {
            return v.visit(*this);
        }
    };
    struct Food:Item {
        string accept(Visitor& v) override {
            return v.visit(*this);
        }
    };
    struct Cashier:Visitor {
        string visit(Book&) override {
            return "B";
        }
        string visit(Food&) override {
            return "F";
        }
    };
    string demo() {
        Cashier v;
        Book a;
        Food b;
        return a.accept(v)+b.accept(v);
    }
}
int main() {
    string actual=Visitor::demo();
    assert(actual=="BF");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`BF`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 10. 模板方法（Template）

父类固定算法流程，抽象步骤由子类实现。

Java 完整教学程序（保存为 TemplateDemo.java）：

```java
import java.util.*;
public class TemplateDemo {
    static abstract class Task {
        final String run() {
            return "open,"+process()+",close";
        }
        abstract String process();
    }
    static class ImportTask extends Task {
        String process() {
            return "read";
        }
    }
    static String demo() {
        Task t=new ImportTask();
        return t.run();
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("open,read,close"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Template {
    struct Task {
        string run() {
            return "open,"+process()+",close";
        }
        virtual string process()=0;
        virtual ~Task()=default;
    };
    struct ImportTask:Task {
        string process() override {
            return "read";
        }
    };
    string demo() {
        ImportTask t;
        return t.run();
    }
}
int main() {
    string actual=Template::demo();
    assert(actual=="open,read,close");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`open,read,close`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 11. 抽象工厂（Factory）

同一工厂创建兼容的产品族，客户端依赖抽象产品。

Java 完整教学程序（保存为 FactoryDemo.java）：

```java
import java.util.*;
public class FactoryDemo {
    interface Button {
        String show();
    }
    interface Menu {
        String show();
    }
    static class DarkButton implements Button {
        public String show() {
            return "dark-button";
        }
    }
    static class DarkMenu implements Menu {
        public String show() {
            return "dark-menu";
        }
    }
    interface Factory {
        Button button();
        Menu menu();
    }
    static class DarkFactory implements Factory {
        public Button button() {
            return new DarkButton();
        }
        public Menu menu() {
            return new DarkMenu();
        }
    }
    static String demo() {
        Factory f=new DarkFactory();
        return f.button().show()+","+f.menu().show();
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("dark-button,dark-menu"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Factory {
    struct Button {
        virtual string show()=0;
        virtual ~Button()=default;
    };
    struct Menu {
        virtual string show()=0;
        virtual ~Menu()=default;
    };
    struct DarkButton:Button {
        string show() override {
            return "dark-button";
        }
    };
    struct DarkMenu:Menu {
        string show() override {
            return "dark-menu";
        }
    };
    struct Factory {
        virtual unique_ptr<Button> button()=0;
        virtual unique_ptr<Menu> menu()=0;
        virtual ~Factory()=default;
    };
    struct DarkFactory:Factory {
        unique_ptr<Button> button() override {
            return make_unique<DarkButton>();
        }
        unique_ptr<Menu> menu() override {
            return make_unique<DarkMenu>();
        }
    };
    string demo() {
        DarkFactory f;
        return f.button()->show()+","+f.menu()->show();
    }
}
int main() {
    string actual=Factory::demo();
    assert(actual=="dark-button,dark-menu");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`dark-button,dark-menu`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 12. 生成器（Builder）

指挥者控制步骤，建造者保存并返回产品。

Java 完整教学程序（保存为 BuilderDemo.java）：

```java
import java.util.*;
public class BuilderDemo {
    static class Product {
        String text="";
    }
    interface Builder {
        void first();
        void second();
        Product result();
    }
    static class MealBuilder implements Builder {
        final Product p=new Product();
        public void first() {
            p.text+="rice";
        }
        public void second() {
            p.text+=",tea";
        }
        public Product result() {
            return p;
        }
    }
    static class Director {
        Product construct(Builder b) {
            b.first();
            b.second();
            return b.result();
        }
    }
    static String demo() {
        return new Director().construct(new MealBuilder()).text;
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("rice,tea"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Builder {
    struct Product {
        string text;
    };
    struct Builder {
        virtual void first()=0;
        virtual void second()=0;
        virtual Product result()=0;
        virtual ~Builder()=default;
    };
    struct MealBuilder:Builder {
        Product p;
        void first() override {
            p.text+="rice";
        }
        void second() override {
            p.text+=",tea";
        }
        Product result() override {
            return p;
        }
    };
    struct Director {
        Product construct(Builder& b) {
            b.first();
            b.second();
            return b.result();
        }
    };
    string demo() {
        MealBuilder b;
        Director d;
        return d.construct(b).text;
    }
}
int main() {
    string actual=Builder::demo();
    assert(actual=="rice,tea");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`rice,tea`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 13. 原型（Prototype）

通过多态 clone 复制对象；验证副本与原型不共享可变状态。

Java 完整教学程序（保存为 PrototypeDemo.java）：

```java
import java.util.*;
public class PrototypeDemo {
    interface Prototype {
        Prototype copy();
    }
    static class Record implements Prototype {
        final List<String> tags;
        Record(List<String> t) {
            tags=new ArrayList<>(t);
        }
        public Record copy() {
            return new Record(tags);
        }
    }
    static String demo() {
        Record a=new Record(Arrays.asList("A"));
        Record b=a.copy();
        b.tags.add("B");
        return a.tags.size()+","+b.tags.size();
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("1,2"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Prototype {
    struct Prototype {
        virtual unique_ptr<Prototype> clone() const=0;
        virtual ~Prototype()=default;
    };
    struct Record:Prototype {
        vector<string> tags;
        explicit Record(vector<string> t):tags(std::move(t)) {
        }
        unique_ptr<Prototype> clone() const override {
            return make_unique<Record>(*this);
        }
    };
    string demo() {
        Record a( {
            "A"
        }
        );
        auto base=a.clone();
        auto& b=dynamic_cast<Record&>(*base);
        b.tags.push_back("B");
        return to_string(a.tags.size())+","+to_string(b.tags.size());
    }
}
int main() {
    string actual=Prototype::demo();
    assert(actual=="1,2");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`1,2`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 14. 备忘录（Memento）

发起人保存/恢复状态，管理者保存快照而不修改其内容。

Java 完整教学程序（保存为 MementoDemo.java）：

```java
import java.util.*;
public class MementoDemo {
    static class Snapshot {
        private final String value;
        Snapshot(String v) {
            value=v;
        }
    }
    static class Editor {
        String text="";
        Snapshot save() {
            return new Snapshot(text);
        }
        void restore(Snapshot s) {
            text=s.value;
        }
    }
    static String demo() {
        Editor e=new Editor();
        e.text="draft";
        Snapshot s=e.save();
        e.text="changed";
        e.restore(s);
        return e.text;
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("draft"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Memento {
    class Editor;
    class Snapshot {
        friend class Editor;
        string value;
        explicit Snapshot(string v):value(std::move(v)) {
        }
    };
    class Editor {
        public:string text;
        Snapshot save() const {
            return Snapshot(text);
        }
        void restore(const Snapshot& s) {
            text=s.value;
        }
    };
    string demo() {
        Editor e;
        e.text="draft";
        auto s=e.save();
        e.text="changed";
        e.restore(s);
        return e.text;
    }
}
int main() {
    string actual=Memento::demo();
    assert(actual=="draft");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`draft`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 15. 中介者（Mediator）

同事只知道中介者，由中介者决定通知对象。

Java 完整教学程序（保存为 MediatorDemo.java）：

```java
import java.util.*;
public class MediatorDemo {
    interface Mediator {
        void send(String text,Peer from);
    }
    static class Peer {
        final Mediator mediator;
        String received="";
        Peer(Mediator m) {
            mediator=m;
        }
        void send(String s) {
            mediator.send(s,this);
        }
        void receive(String s) {
            received=s;
        }
    }
    static class Hub implements Mediator {
        Peer a,b;
        public void send(String s,Peer from) {
            if(from==a)b.receive(s);
            else a.receive(s);
        }
    }
    static String demo() {
        Hub h=new Hub();
        h.a=new Peer(h);
        h.b=new Peer(h);
        h.a.send("hello");
        return h.b.received;
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("hello"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Mediator {
    struct Peer;
    struct Mediator {
        virtual void send(const string&,Peer*)=0;
        virtual ~Mediator()=default;
    };
    struct Peer {
        Mediator& mediator;
        string received;
        explicit Peer(Mediator& m):mediator(m) {
        }
        void send(const string& s) {
            mediator.send(s,this);
        }
        void receive(const string& s) {
            received=s;
        }
    };
    struct Hub:Mediator {
        Peer* a=nullptr;
        Peer* b=nullptr;
        void send(const string& s,Peer* from) override {
            assert(a&&b);
            (from==a?b:a)->receive(s);
        }
    };
    string demo() {
        Hub h;
        Peer a(h),b(h);
        h.a=&a;
        h.b=&b;
        a.send("hello");
        return b.received;
    }
}
int main() {
    string actual=Mediator::demo();
    assert(actual=="hello");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`hello`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 16. 外观（Facade）

门面串联子系统调用；客户端只认识统一入口。

Java 完整教学程序（保存为 FacadeDemo.java）：

```java
import java.util.*;
public class FacadeDemo {
    static class Stock {
        String reserve() {
            return "stock";
        }
    }
    static class Shipping {
        String send() {
            return "ship";
        }
    }
    static class Shop {
        final Stock stock=new Stock();
        final Shipping shipping=new Shipping();
        String buy() {
            return stock.reserve()+","+shipping.send();
        }
    }
    static String demo() {
        return new Shop().buy();
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("stock,ship"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Facade {
    struct Stock {
        string reserve() {
            return "stock";
        }
    };
    struct Shipping {
        string send() {
            return "ship";
        }
    };
    struct Shop {
        Stock stock;
        Shipping shipping;
        string buy() {
            return stock.reserve()+","+shipping.send();
        }
    };
    string demo() {
        Shop s;
        return s.buy();
    }
}
int main() {
    string actual=Facade::demo();
    assert(actual=="stock,ship");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`stock,ship`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 17. 享元（Flyweight）

工厂按内部状态复用对象，外部状态在调用时传入。

Java 完整教学程序（保存为 FlyweightDemo.java）：

```java
import java.util.*;
public class FlyweightDemo {
    static class Glyph {
        final String type;
        Glyph(String t) {
            type=t;
        }
        String draw(int x) {
            return type+"@"+x;
        }
    }
    static class Factory {
        final Map<String,Glyph> pool=new HashMap<>();
        Glyph get(String t) {
            return pool.computeIfAbsent(t,Glyph::new);
        }
    }
    static String demo() {
        Factory f=new Factory();
        Glyph a=f.get("A"),b=f.get("A");
        if(a!=b)throw new AssertionError();
        return b.draw(3);
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("A@3"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Flyweight {
    struct Glyph {
        string type;
        explicit Glyph(string t):type(std::move(t)) {
        }
        string draw(int x) const {
            return type+"@"+to_string(x);
        }
    };
    struct Factory {
        map<string,shared_ptr<Glyph>> pool;
        shared_ptr<Glyph> get(const string& t) {
            auto& p=pool[t];
            if(!p)p=make_shared<Glyph>(t);
            return p;
        }
    };
    string demo() {
        Factory f;
        auto a=f.get("A"),b=f.get("A");
        assert(a==b);
        return b->draw(3);
    }
}
int main() {
    string actual=Flyweight::demo();
    assert(actual=="A@3");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`A@3`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 18. 责任链（Chain）

请求沿后继传递；当前处理者不能处理才交给下一位。

Java 完整教学程序（保存为 ChainDemo.java）：

```java
import java.util.*;
public class ChainDemo {
    static abstract class Handler {
        Handler next;
        Handler link(Handler n) {
            next=n;
            return n;
        }
        abstract String handle(int level);
    }
    static class Worker extends Handler {
        final int limit;
        Worker(int n) {
            limit=n;
        }
        String handle(int n) {
            if(n<=limit)return "L"+limit;
            return next==null?"unhandled":next.handle(n);
        }
    }
    static String demo() {
        Handler a=new Worker(1);
        a.link(new Worker(3));
        return a.handle(2)+","+a.handle(5);
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("L3,unhandled"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Chain {
    struct Handler {
        Handler* next=nullptr;
        Handler& link(Handler& n) {
            next=&n;
            return n;
        }
        virtual string handle(int)=0;
        virtual ~Handler()=default;
    };
    struct Worker:Handler {
        int limit;
        explicit Worker(int n):limit(n) {
        }
        string handle(int n) override {
            if(n<=limit)return "L"+to_string(limit);
            return next?next->handle(n):"unhandled";
        }
    };
    string demo() {
        Worker a(1),b(3);
        a.link(b);
        return a.handle(2)+","+a.handle(5);
    }
}
int main() {
    string actual=Chain::demo();
    assert(actual=="L3,unhandled");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`L3,unhandled`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

#### 19. 迭代器（Iterator）

聚合对象提供迭代入口；先判断终点再读取/推进。

Java 完整教学程序（保存为 IteratorDemo.java）：

```java
import java.util.*;
public class IteratorDemo {
    static class Catalog implements Iterable<String> {
        final List<String> items=Arrays.asList("A","B");
        public Iterator<String> iterator() {
            return items.iterator();
        }
    }
    static String demo() {
        Iterator<String> it=new Catalog().iterator();
        StringBuilder out=new StringBuilder();
        while(it.hasNext())out.append(it.next());
        if(it.hasNext())throw new AssertionError();
        return out.toString();
    }
    public static void main(String[] args) {
        String actual=demo();
        if(!actual.equals("AB"))throw new AssertionError(actual);
        System.out.println(actual);
    }
}
```

C++17 完整教学程序：

```cpp
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;
namespace Iterator {
    struct Catalog {
        vector<string> items {
            "A","B"
        };
        auto begin() const {
            return items.begin();
        }
        auto end() const {
            return items.end();
        }
    };
    string demo() {
        Catalog c;
        string s;
        for(auto it=c.begin();it!=c.end();++it)s+=*it;
        return s;
    }
}
int main() {
    string actual=Iterator::demo();
    assert(actual=="AB");
    cout<<actual<<"\n";
    return 0;
}
```

运行结果：`AB`。先遮住成员声明、构造/装配和关键委托语句，按上述职责自行补全，再核对接口签名与实际输出。

### 5.3 双语语法静态检查六步自检法则

| 检查项 | Java 关键检查点 | C++ 关键检查点 |
|---|---|---|
| **1. 继承与实现** | 严格单继承 `extends`，多接口 `implements A, B` | `: public BaseClass`（切勿遗漏 `public`） |
| **2. 抽象方法声明** | `public abstract void action();` | `virtual void action() = 0;`（纯虚函数） |
| **3. 析构函数** | 垃圾回收器自动回收，无需析构 | 经基类指针销毁派生对象时需虚析构：`virtual ~Base() {}` |
| **4. 构造链调用** | 子类首行调用：`super(args);` | 初始化列表传参：`Derived(...) : Base(args)` |
| **5. 指针与引用** | 引用变量一律使用点号 `.` | 按表达式类型判定：对象/对象引用用 `.`，指针用 `->`（或 `(*p).`）；指针的引用仍按指针操作 |
| **6. 容器遍历** | `for (Component c : list)` 或迭代器强转 | `vector<Item*>::iterator it` 解引用 `(*it)->action()` |

### 5.4 19 种教学模式填空核查表

| 模式 | 需要检查的职责和代码链 |
|---|---|
| 桥接 | 两个独立变化维度；抽象持有实现接口，先装配再委托。检查接口签名、成员类型、构造实参和最终调用。 |
| 组合 | 叶子与容器共享接口；容器保存抽象构件并递归分派。检查接口签名、成员类型、构造实参和最终调用。 |
| 策略 | 环境类保存可替换策略；构造/Setter 注入，业务入口委托。检查接口签名、成员类型、构造实参和最终调用。 |
| 状态 | 行为取决于当前状态；状态对象通过 Context 改变后续行为。检查接口签名、成员类型、构造实参和最终调用。 |
| 观察者 | 目标维护观察者集合，状态改变后通知全部订阅者。检查接口签名、成员类型、构造实参和最终调用。 |
| 适配器 | 目标接口与旧接口不兼容；适配器持有旧对象并转换调用。检查接口签名、成员类型、构造实参和最终调用。 |
| 装饰 | 装饰器也实现构件接口，委托原构件后增加职责。检查接口签名、成员类型、构造实参和最终调用。 |
| 命令 | 调用者持有命令接口；具体命令保存接收者并调用其业务。检查接口签名、成员类型、构造实参和最终调用。 |
| 访问者 | accept 接收访问者，内部 visit(this) 完成双分派。检查接口签名、成员类型、构造实参和最终调用。 |
| 模板方法 | 父类固定算法流程，抽象步骤由子类实现。检查接口签名、成员类型、构造实参和最终调用。 |
| 抽象工厂 | 同一工厂创建兼容的产品族，客户端依赖抽象产品。检查接口签名、成员类型、构造实参和最终调用。 |
| 生成器 | 指挥者控制步骤，建造者保存并返回产品。检查接口签名、成员类型、构造实参和最终调用。 |
| 原型 | 通过多态 clone 复制对象；验证副本与原型不共享可变状态。检查接口签名、成员类型、构造实参和最终调用。 |
| 备忘录 | 发起人保存/恢复状态，管理者保存快照而不修改其内容。检查接口签名、成员类型、构造实参和最终调用。 |
| 中介者 | 同事只知道中介者，由中介者决定通知对象。检查接口签名、成员类型、构造实参和最终调用。 |
| 外观 | 门面串联子系统调用；客户端只认识统一入口。检查接口签名、成员类型、构造实参和最终调用。 |
| 享元 | 工厂按内部状态复用对象，外部状态在调用时传入。检查接口签名、成员类型、构造实参和最终调用。 |
| 责任链 | 请求沿后继传递；当前处理者不能处理才交给下一位。检查接口签名、成员类型、构造实参和最终调用。 |
| 迭代器 | 聚合对象提供迭代入口；先判断终点再读取/推进。检查接口签名、成员类型、构造实参和最终调用。 |

## 6. 从完整程序到得分空位的闭卷训练

先固定一种主攻语言，再用另一种语言核对相同角色。按题面语言选题，不按平台题号推断。每个空都写下“此处应产生什么类型、由谁持有、调用谁的方法、参数从哪里来”。

### 6.1 策略：声明、注入、委托三处连练

Java：`interface Pay { int cost(int amount); }`；Order 中成员空为 `Pay pay`，构造参数为 `Pay p`，赋值空为 `this.pay = p`，业务返回空为 `pay.cost(amount)`。若接口方法声明留空，要填完整 `int cost(int amount)`，不能只填 cost。

C++：`Pay* pay` 保存非拥有指针；构造 `Order(Pay& p) : pay(&p) {}`；调用 `pay->cost(amount)`。若改为 `Pay& pay`，初始化为 `pay(p)`，调用改为 `pay.cost(amount)`。必须先看类型再选符号。

自测：环境类持有 `Rule* rule`，接口 `virtual int calc(int n)=0;`，构造接收 `Rule& r`。补初始化与执行表达式。（`rule(&r)`；`rule->calc(n)`。）

### 6.2 组合：共同属性、抽象签名、容器和初始化

Java 父类共同属性 `String name`；抽象方法 `public abstract void draw();`；子构件集合 `List<Node> children = new ArrayList<>();`。若题面已给 `public` 与分号，空内只写 `abstract void draw()`。构造器有字符串形参时，`new Group("root")` 要传入实参。

C++ 抽象方法 `virtual void draw() = 0;`；集合可为 `vector<Node*> children`，遍历 `for (Node* child : children) child->draw();`。非拥有集合的 remove 只解除连接，不能擅自 delete；若父节点负责所有权，应换明确的拥有模型并处理整棵树的销毁。

自测：root 含 sub，sub 含 a，root 另含 b，调用 root.draw 应触发哪些叶子？移除 sub 后呢？（先 a、b；移除后只 b。）

### 6.3 桥接：先装配实现，再执行抽象操作

Java：`Shape s = new Circle(new Screen()); s.draw();`。C++：`Screen p; Circle c(p); Shape& s=c; s.draw();`。抽象角色应依赖 Painter 接口，不能写死 Screen 类型；业务执行时调用所持有实现者。

自测：加入 Printer 实现和 Square 抽象子类，是否需要为 ScreenSquare、PrinterSquare 分别建类？（不需要，分别新增独立维度的类，再装配即可。）

### 6.4 模式辨析与逐空验收

- 策略与状态：前者选择可替换算法，后者根据当前状态决定行为及迁移；不能只因都有接口引用就判同一模式。
- 桥接与适配器：前者预先分离变化维度，后者解决已有接口不兼容。
- 装饰与组合：前者包装并增加职责，后者表达部分—整体并递归分派。
- 工厂与责任链：工厂创建对象；责任链把请求交给候选处理者并逐级转交。
- 每个空核对声明上下文、访问权限、返回类型、参数、构造链、实例化实参、分号边界和实际调用结果。先遮住答案作答，再运行迁移例验证，不能以“看懂代码”替代闭卷补全。
