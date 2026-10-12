# 面向对象设计模式与 Java/C++ 实现案例

> 本专题专为软考下午试题五（Java 程序设计）与试题六（C++ 程序设计）（15 分二选一选做题）定制。考生拿到题目后，可直接对照设问类型（识别模式、填继承接口、填构造创建、填委托多态、静态语法检查），定位至对应作答卡快速展开推理作答。

---

## 1. 设计模式题型识别与考场通用破题流程

### 1.1 试题识别与题面结构
- **试题位置**：下午试题五（Java）或试题六（C++），满分 15 分，考题内容同构，仅编程语言与语法不同。
- **题面三件套**：
  1. **设计意图与业务背景说明**：描述系统遇到的扩展性挑战（如避免类爆炸、解耦算法族、动态通知各界面、统一树形结构、撤销历史恢复）；
  2. **设计模式类图框架**：给出涉及的接口、抽象类、具体实现类、上下文类之间的继承（实线空心三角）、实现（虚线空心三角）与聚合关联（实线带箭头）连线；
  3. **挖空的源码框架**：给出 5 至 6 处代码空缺（每空 2.5～3 分），要求补充类继承关系、构造器、多态委托调用或对象创建。

### 1.2 考场四步快速解题流水线
```text
第 1 步：读意图抓信号，判定模式名称 → 查职责三问与考场速查表，判定具体是 16 种经典模式中的哪一种
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
- **【知识依赖】**：[16 种设计模式考场速记表](#51-16-种经典设计模式考场速查总表)。

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
- **【知识依赖】**：[各设计模式标准角色体系](#52-16-种设计模式标准双语实现库)。

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
- **【知识依赖】**：[16 种设计模式标准双语实现库](#52-16-种设计模式标准双语实现库)。
- **【易错与自检】**：
  - *陷阱*：Java 与 C++ 的解引用符号搞混（Java 均用点号 `.`；C++ 指针变量必须用箭头 `->`）；
  - *自检*：调用的方法名是否与类图中该接口定义的方法名拼写、大小写完全一致？

---

### 作答卡 DP-05：C++ 与 Java 双语核心填空语法对照速查卡

- **【题型识别】**：面向试题五（Java）与试题六（C++）共用同一套模式语义时的语言级代码填空转换。
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
  - **答案**：`imp.doPaint(m)`（套用 [作答卡 DP-05](#作答卡-dp-05委托调用与多态分派代码填空)）。
- **空 (3) 与空 (4)：根据客户端需求实例化具体图像与平台实现对象**：
  - **取证**：`main` 方法注释明确指定“在 Linux 操作系统上查看 demo.gif 图像文件”。
  - **推理**：
    - 图像格式为 GIF，对应抽象子类实例化：空 (3) 填 `new GIFImage()`；
    - 操作系统为 Linux，对应具体实现子类实例化：空 (4) 填 `new LinuxImp()`。
  - **答案**：
    - (3) `new GIFImage()`
    - (4) `new LinuxImp()`（套用 [作答卡 DP-04](#作答卡-dp-04构造链与实例创建代码填空)）。
- **空 (5)：依赖注入装配桥接关系**：
  - **取证**：已创建图像对象 `image` 与平台实现对象 `imageImp`，随后执行 `image.parseFile("demo.gif");`。
  - **推理**：调用解析与绘制前，必须将具体操作系统实现注入到图像抽象对象中。基类 `Image` 提供了 Setter 注入方法 `public void setImp(Implementor imp)`。
  - **答案**：`image.setImp(imageImp)`（套用 [作答卡 DP-05](#作答卡-dp-05委托调用与多态分派代码填空)）。

---

## 4. 易错陷阱与交卷自检清单

交卷前花 2 分钟逐项对照以下清单自检：

- [ ] **分号遗漏排查**：检查所填代码行末尾是否缺少了必需的分号 `;`？
- [ ] **指针符号核对**：C++ 指针调用是否均写成了箭头 `->`？纯虚函数是否写成了 `= 0;`？
- [ ] **构造函数名称**：构造函数名是否与类名拼写完全一致且没有返回值类型？
- [ ] **克隆类型强转**：Java 调用 `clone()` 后，是否加了具体类型的括号向下强转？
- [ ] **角色颠倒自检**：委托调用时，是委托给持有的依赖对象，而不是将上下文反向操控外部对象？

---

## 5. 支撑知识详解（16 种设计模式标准双语实现库）

### 5.1 16 种经典设计模式考场速查总表
| 模式名称 | 分类 | 核心解题识别信号 | 典型考场场景 |
|---|---|---|---|
| **桥接模式 (Bridge)** | 结构型 | 抽象与实现分离，两个独立变化的维度 | 跨平台图像渲染（格式 × 操作系统） |
| **组合模式 (Composite)** | 结构型 | 部分—整体树形层次，叶子与容器一致对待 | 多级菜单树、组织架构树、文件目录 |
| **适配器模式 (Adapter)** | 结构型 | 已有类接口不兼容但需复用，包装转换 | 新系统对接老地址库/老支付接口 |
| **装饰模式 (Decorator)** | 结构型 | 动态透明增加职责，用组合替代继承 | 发票加头加尾、数据流多层加密压缩 |
| **外观模式 (Facade)** | 结构型 | 为复杂子系统提供统一的高层接待门面 | 医院前台接待（挂号/门诊/划价一站式） |
| **享元模式 (Flyweight)** | 结构型 | 大量细粒度对象共享，区分内部与外部状态 | 网络围棋黑白棋子（共享颜色，坐标外传） |
| **策略模式 (Strategy)** | 行为型 | 封装一系列可相互替换的算法族，独立变化 | 促销收银打折、不同图书借阅计费规则 |
| **状态模式 (State)** | 行为型 | 行为随生命周期状态改变而改变，消除庞大分支 | 自动售货机流转、航空会员里程升级 |
| **观察者模式 (Observer)** | 行为型 | 一对多依赖，一个对象状态变动自动广播通知 | 实验室环境监控（温度变化多块仪表更新） |
| **中介者模式 (Mediator)** | 行为型 | 平级对象复杂网状依赖解耦为星状中介协同 | 多平台电商支付中介、飞机航行调度塔台 |
| **备忘录模式 (Memento)** | 行为型 | 不破坏封装捕获内部状态，支持撤销/恢复 | 编辑器 Undo/Redo、历史快照恢复 |
| **命令模式 (Command)** | 行为型 | 请求发送者与接收者解耦，支持队列/宏命令 | 股票交易委托代理、遥控器按钮宏命令 |
| **模板方法 (Template Method)** | 行为型 | 父类定义算法骨架，子类重写可变步骤 | 应用程序框架（openDocument 固定 5 步） |
| **访问者模式 (Visitor)** | 行为型 | 元素结构稳定，操作随需求不断新增（双分派） | 超市收银员访问不同商品结算（accept/visit） |
| **生成器模式 (Builder)** | 创建型 | 复杂对象分步构建与表现分离，指挥者编排 | 餐厅套餐制作（指挥者服务员调度建造者） |
| **原型模式 (Prototype)** | 创建型 | 通过拷贝/克隆原型创建新对象，避免昂贵初始化 | 大对象高效复制（Java Cloneable / C++ 拷贝构造） |

---

### 5.2 16 种设计模式标准双语实现库

#### 1. 中介者模式 (Mediator)
- **依赖方向**：同事 → 中介者 → 相关同事，同事之间互不相识。
- **Java 核心实现**：
  ```java
  interface Mediator { void send(String msg, Colleague c); }
  class ConcreteMediator implements Mediator {
      private ConcreteColleague1 c1;
      private ConcreteColleague2 c2;
      public void send(String msg, Colleague c) {
          if (c == c1) c2.notify(msg); else c1.notify(msg);
      }
  }
  ```

#### 2. 模板方法模式 (Template Method)
- **核心骨架（Application / Document 模型）**：
  ```cpp
  void Application::openDocument(const string& name) {
      if (!canOpenDocument(name)) return;
      Document* doc = doCreateDocument(); // 工厂方法延迟到子类
      doc->open(name);
      doc->read(name);
      addDocument(doc);
  }
  ```

#### 3. 访问者模式 (Visitor)
- **双分派机制**：`item.accept(visitor)` ──内部调用──▶ `visitor.visit(this);`。
- **Java 核心实现**：
  ```java
  interface Item { void accept(Visitor v); }
  class Book implements Item {
      public void accept(Visitor v) { v.visit(this); }
  }
  class Cashier implements Visitor {
      public void visit(Book b) { /* 结算图书 */ }
  }
  ```

#### 4. 抽象工厂模式 (Abstract Factory)
- **创建产品族**：
  ```cpp
  class IFactory {
  public:
      virtual IUser* CreateUser() = 0;
      virtual IDepartment* CreateDepartment() = 0;
  };
  ```

#### 5. 观察者模式 (Observer)
- **广播通知机制**：
  ```java
  class EnvironmentData implements Subject {
      private List<Observer> observers = new ArrayList<>();
      public void notifyObservers() {
          for (Observer o : observers) { o.update(temperature, humidity); }
      }
  }
  ```

#### 6. 备忘录模式 (Memento)
- **三角色协作**：
  ```java
  // Originator
  public Memento saveState() { return new Memento(state); }
  public void restoreState(Memento m) { this.state = m.getState(); }
  // Caretaker 管理历史列表
  caretaker.add(originator.saveState());
  originator.restoreState(caretaker.get(index));
  ```

#### 7. 命令模式 (Command)
- **参数化与解耦**：
  ```java
  class ConcreteCommand implements Command {
      private Receiver receiver;
      public ConcreteCommand(Receiver r) { this.receiver = r; }
      public void execute() { receiver.action(); }
  }
  ```

#### 8. 策略模式 (Strategy)
- **算法族可替换**：
  ```java
  class Duck {
      protected FlyBehavior flyBehavior;
      public void performFly() { flyBehavior.fly(); } // 委托调用
  }
  ```

#### 9. 状态模式 (State)
- **状态驱动上下文流转**：
  ```java
  class StartState implements State {
      public void doAction(Context context) {
          context.setState(this); // 驱动环境状态切换
      }
  }
  ```

#### 10. 享元模式 (Flyweight)
- **内外状态分离**：颜色为内部共享状态（存放在享元池），坐标 `(x, y)` 为外部状态由调用端传入。

#### 11. 适配器模式 (Adapter)
- **接口转换**：
  ```cpp
  class Adapter : public Target {
  private:
      Adaptee* adaptee;
  public:
      virtual void request() { adaptee->specificRequest(); }
  };
  ```

#### 12. 生成器模式 (Builder)
- **指挥者调度建造者**：
  ```java
  public void constructMeal(MealBuilder builder) {
      builder.buildBurger();
      builder.buildDrink();
  }
  ```

#### 13. 装饰模式 (Decorator)
- **组合包装增强**：
  ```cpp
  void Decorator::print() {
      component->print(); // 基础调用
      printFooter();      // 装饰增强
  }
  ```

#### 14. 组合模式 (Composite)
- **树形递归多态调用**：
  ```java
  public void print() {
      for (Component c : components) { c.print(); }
  }
  ```

#### 15. 外观模式 (Facade)
- **子系统统一门面**：
  ```java
  public void dispose() {
      registration.handle();
      outpatient.handle();
      pharmacy.handle();
  }
  ```

#### 16. 桥接模式 (Bridge)
- **双维度聚合解耦**：
  ```java
  abstract class Image {
      protected ImageImp imp; // 组合实现接口
      public abstract void parseFile(String name);
  }
  ```

#### 17. 原型模式 (Prototype)
- **克隆机制**：Java 实现 `Cloneable` 接口并调用 `super.clone()`；C++ 提供纯虚 `virtual Prototype* Clone() = 0;` 并调用拷贝构造函数 `return new ConcretePrototype(*this);`。

---

### 5.3 双语语法静态检查六步自检法则

| 检查项 | Java 关键检查点 | C++ 关键检查点 |
|---|---|---|
| **1. 继承与实现** | 严格单继承 `extends`，多接口 `implements A, B` | `: public BaseClass`（切勿遗漏 `public`） |
| **2. 抽象方法声明** | `public abstract void action();` | `virtual void action() = 0;`（纯虚函数） |
| **3. 析构函数** | 垃圾回收器自动回收，无需析构 | 基类必须声明虚析构：`virtual ~Base() {}` |
| **4. 构造链调用** | 子类首行调用：`super(args);` | 初始化列表传参：`Derived(...) : Base(args)` |
| **5. 指针与引用** | 引用变量一律使用点号 `.` | 指针变量一律使用箭头 `->`，对象使用 `.` |
| **6. 容器遍历** | `for (Component c : list)` 或迭代器强转 | `vector<Item*>::iterator it` 解引用 `(*it)->action()` |

### 5.4 16 种真题考查模式核心代码骨架填空速查表

下表汇总了历年案例真题试题五/六所覆盖的 16 种设计模式的高频挖空位置与代码填空套路：

| 模式名称 | 核心结构特征 | 最高频挖空位置 | Java / C++ 填空标准套路 |
|---|---|---|---|
| **桥接模式 (Bridge)** | 抽象化持有实现化接口 `imp` | 构造/Setter注入、委托调用 | `imp.doPaint(m);` / `imp->doPaint(m);` |
| **组合模式 (Composite)** | 容器既继承构件又聚合构件集合 | 递归遍历子构件分派调用 | `for(Component c : list) c.print();` |
| **观察者模式 (Observer)** | 目标类维护观察者列表 | 状态变更后循环通知 | `for(Observer o : observers) o.update(state);` |
| **策略模式 (Strategy)** | 环境类持有策略接口引用 | 执行算法时委托策略对象 | `strategy.algorithmInterface(param);` |
| **状态模式 (State)** | 状态类持有环境类并触发切换 | 状态流转时重设环境状态 | `context.setState(new StateB());` |
| **访问者模式 (Visitor)** | 元素类 `accept` 与访问者 `visit` | 双分派调用互传 `this` | `visitor.visit(this);` / `element.accept(v);` |
| **装饰模式 (Decorator)** | 装饰器持有被装饰构件 `component`| 调用前后增加附加功能 | `super.operation();` 或 `component.operation();` |
| **适配器模式 (Adapter)** | 适配器持有被适配者 `adaptee` | 接口转换委托调用 | `adaptee.specificRequest();` |
| **备忘录模式 (Memento)** | 发起人创建与恢复备忘录 | 保存状态与恢复状态 | `return new Memento(state);` / `this.state = m.getState();` |
| **命令模式 (Command)** | 命令类持有接收者 `receiver` | `execute()` 内部调用接收者 | `receiver.action();` |
| **享元模式 (Flyweight)** | 工厂管理内部状态对象池 | 池化查询与按需创建 | `if(!pool.containsKey(key)) pool.put(key, new ...);` |
| **生成器模式 (Builder)** | 指导者 `Director` 组装构建过程 | 分步调用各构造零件方法 | `builder.buildPartA(); builder.buildPartB();` |
| **模板方法 (Template Method)** | 父类定义骨架，子类重写基本方法 | 抽象基类中定义基本方法签名 | `abstract void stepOne();` / `virtual void step() = 0;` |
| **迭代器模式 (Iterator)** | 聚合对象提供创建迭代器工厂方法 | 迭代游标推进与越界判断 | `return new ConcreteIterator(this);` |
| **责任链模式 (Chain of Resp.)** | 处理者持有下一后继者 `successor` | 无法处理时后继传递 | `if(successor != null) successor.handle(request);` |
| **抽象工厂模式 (Abstract Factory)**| 工厂接口声明创建一组产品族方法 | 具体工厂实现具体产品创建 | `return new ConcreteProductA();` |

