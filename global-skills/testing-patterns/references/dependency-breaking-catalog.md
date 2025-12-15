# Dependency-Breaking Techniques Catalog

From Michael Feathers' "Working Effectively with Legacy Code" - 25 techniques for getting code under test.

## Constructor Problems

### Parameterize Constructor

**When**: Constructor creates dependencies internally.

```typescript
// Before
class ReportGenerator {
  private db: Database;
  constructor() {
    this.db = new ProductionDatabase();
  }
}

// After
class ReportGenerator {
  private db: Database;
  constructor(db: Database = new ProductionDatabase()) {
    this.db = db;
  }
}

// Test
const generator = new ReportGenerator(new FakeDatabase());
```

### Extract and Override Factory Method

**When**: Constructor creates object you can't easily replace.

```typescript
// Before
class OrderProcessor {
  private validator: Validator;
  constructor() {
    this.validator = new ComplexValidator();
  }
}

// After
class OrderProcessor {
  private validator: Validator;
  constructor() {
    this.validator = this.createValidator();
  }

  protected createValidator(): Validator {
    return new ComplexValidator();
  }
}

// Test subclass
class TestableOrderProcessor extends OrderProcessor {
  protected createValidator(): Validator {
    return new SimpleValidator();
  }
}
```

### Supersede Instance Variable

**When**: Can't change constructor, but can add setter.

```typescript
class PaymentService {
  private gateway = new StripeGateway();

  // Add for testing only
  _setGatewayForTesting(gateway: PaymentGateway) {
    this.gateway = gateway;
  }
}
```

**Warning**: Use sparingly. Prefer constructor injection.

## Method Problems

### Extract and Override Call

**When**: Method makes problematic call you need to isolate.

```typescript
// Before
class OrderService {
  process(order: Order) {
    // ... logic
    this.sendEmail(order.customer); // problematic
    // ... more logic
  }

  private sendEmail(customer: Customer) {
    emailService.send(customer.email, "Order confirmed");
  }
}

// After - make protected, override in test
class OrderService {
  process(order: Order) {
    // ... logic
    this.sendEmail(order.customer);
    // ... more logic
  }

  protected sendEmail(customer: Customer) {
    emailService.send(customer.email, "Order confirmed");
  }
}

class TestableOrderService extends OrderService {
  emailsSent: Customer[] = [];

  protected sendEmail(customer: Customer) {
    this.emailsSent.push(customer);
  }
}
```

### Parameterize Method

**When**: Method uses hardcoded value that should vary.

```typescript
// Before
function getRecentOrders() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  return db.query(`SELECT * FROM orders WHERE date > ?`, cutoff);
}

// After
function getRecentOrders(days: number = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return db.query(`SELECT * FROM orders WHERE date > ?`, cutoff);
}
```

### Replace Function with Function Pointer

**When**: Need to swap out a function call (especially in C/procedural code).

```typescript
// Before
function processData(data: Data) {
  const validated = validateData(data); // hardcoded call
  return transform(validated);
}

// After
function processData(data: Data, validate: (d: Data) => Data = validateData) {
  const validated = validate(data);
  return transform(validated);
}
```

## Interface Techniques

### Extract Interface

**When**: Need to create test double for a class.

```typescript
// 1. Identify methods used by client
class PaymentGateway {
  charge(amount: number): Receipt { ... }
  refund(receiptId: string): void { ... }
  getBalance(): number { ... }
}

// 2. Extract interface with only needed methods
interface Chargeable {
  charge(amount: number): Receipt;
}

// 3. Implement interface
class PaymentGateway implements Chargeable { ... }

// 4. Create test double
class FakeChargeable implements Chargeable {
  charges: number[] = [];
  charge(amount: number): Receipt {
    this.charges.push(amount);
    return { id: 'fake-receipt' };
  }
}
```

### Extract Implementer

**When**: Class is concrete but you need interface. Similar to Extract Interface but you rename the original.

```typescript
// Before
class MessageQueue {
  send(msg: Message) { ... }
  receive(): Message { ... }
}

// After
interface MessageQueue {
  send(msg: Message): void;
  receive(): Message;
}

class ProductionMessageQueue implements MessageQueue {
  send(msg: Message) { ... }
  receive(): Message { ... }
}
```

### Introduce Instance Delegator

**When**: Static methods prevent testing.

```typescript
// Before - static method
class DateUtils {
  static now(): Date {
    return new Date();
  }
}

// After - instance method delegates to static
class DateUtils {
  static now(): Date {
    return new Date();
  }

  // Instance method for testability
  getCurrentDate(): Date {
    return DateUtils.now();
  }
}

// Or better - extract interface
interface Clock {
  now(): Date;
}

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

class FakeClock implements Clock {
  private time: Date;
  constructor(time: Date) {
    this.time = time;
  }
  now(): Date {
    return this.time;
  }
}
```

## Class Extraction

### Break Out Method Object

**When**: Long method with many local variables. Extract to class where locals become fields.

```typescript
// Before - 200 line method with 15 local variables
class ReportGenerator {
  generate(data: Data): Report {
    let total = 0;
    let items: Item[] = [];
    let categories: Map<string, number> = new Map();
    // ... 200 lines using these variables
  }
}

// After - method becomes class
class ReportGeneration {
  private total = 0;
  private items: Item[] = [];
  private categories: Map<string, number> = new Map();

  constructor(private data: Data) {}

  run(): Report {
    this.calculateTotals();
    this.categorize();
    return this.buildReport();
  }

  private calculateTotals() { ... }
  private categorize() { ... }
  private buildReport() { ... }
}

class ReportGenerator {
  generate(data: Data): Report {
    return new ReportGeneration(data).run();
  }
}
```

### Expose Static Method

**When**: Method doesn't use instance state. Make static to test without instantiation.

```typescript
// Before
class Calculator {
  // Doesn't use 'this' at all
  computeTax(amount: number, rate: number): number {
    return amount * rate;
  }
}

// After
class Calculator {
  static computeTax(amount: number, rate: number): number {
    return amount * rate;
  }
}

// Test without instantiating Calculator
expect(Calculator.computeTax(100, 0.1)).toBe(10);
```

## Global/Static State

### Introduce Static Setter

**When**: Singleton or global state blocks testing.

```typescript
// Before - untestable singleton
class Configuration {
  private static instance: Configuration;

  static getInstance(): Configuration {
    if (!this.instance) {
      this.instance = new Configuration();
    }
    return this.instance;
  }
}

// After - add setter for tests
class Configuration {
  private static instance: Configuration;

  static getInstance(): Configuration {
    if (!this.instance) {
      this.instance = new Configuration();
    }
    return this.instance;
  }

  // For testing only
  static _setInstanceForTesting(config: Configuration) {
    this.instance = config;
  }

  static _resetForTesting() {
    this.instance = undefined!;
  }
}
```

**Warning**: This is a last resort. Prefer dependency injection.

### Encapsulate Global References

**When**: Code uses global variables directly.

```typescript
// Before
let globalConfig: Config;

function processOrder(order: Order) {
  if (globalConfig.taxEnabled) {
    // ...
  }
}

// After - wrap in accessor
class ConfigAccess {
  static getConfig(): Config {
    return globalConfig;
  }

  static _setConfigForTesting(config: Config) {
    globalConfig = config;
  }
}

function processOrder(order: Order) {
  if (ConfigAccess.getConfig().taxEnabled) {
    // ...
  }
}
```

## Subclass Techniques

### Subclass and Override Method

**When**: Need to neutralize or sense a method call.

```typescript
class NotificationService {
  notify(user: User, message: string) {
    this.sendPush(user, message);
    this.sendEmail(user, message);
    this.logNotification(user, message);
  }

  protected sendPush(user: User, message: string) {
    pushService.send(user.deviceId, message);
  }

  protected sendEmail(user: User, message: string) {
    emailService.send(user.email, message);
  }

  protected logNotification(user: User, message: string) {
    logger.info(`Notified ${user.id}: ${message}`);
  }
}

// Test subclass - override problematic methods
class TestableNotificationService extends NotificationService {
  pushes: Array<{ user: User; message: string }> = [];
  emails: Array<{ user: User; message: string }> = [];

  protected sendPush(user: User, message: string) {
    this.pushes.push({ user, message });
  }

  protected sendEmail(user: User, message: string) {
    this.emails.push({ user, message });
  }
}
```

### Push Down Dependency

**When**: Only a few methods have problematic dependencies.

```typescript
// Before - whole class untestable due to one method
class DataProcessor {
  process(data: Data): Result {
    const validated = this.validate(data);
    const transformed = this.transform(validated);
    return this.save(transformed); // problematic
  }

  private save(data: Data): Result {
    return database.insert(data); // real DB call
  }
}

// After - push dependency to subclass
abstract class DataProcessor {
  process(data: Data): Result {
    const validated = this.validate(data);
    const transformed = this.transform(validated);
    return this.save(transformed);
  }

  protected abstract save(data: Data): Result;
}

class ProductionDataProcessor extends DataProcessor {
  protected save(data: Data): Result {
    return database.insert(data);
  }
}

class TestableDataProcessor extends DataProcessor {
  saved: Data[] = [];
  protected save(data: Data): Result {
    this.saved.push(data);
    return { success: true };
  }
}
```

## Adapter Techniques

### Adapt Parameter

**When**: Parameter type is hard to construct in tests.

```typescript
// Before - HttpRequest is hard to construct
function handleRequest(request: HttpRequest): Response {
  const userId = request.headers.get("X-User-Id");
  const body = request.body;
  // ... process
}

// After - extract what you need
interface RequestData {
  userId: string;
  body: unknown;
}

function handleRequest(request: HttpRequest): Response {
  return processRequest({
    userId: request.headers.get("X-User-Id"),
    body: request.body,
  });
}

function processRequest(data: RequestData): Response {
  // ... process - now testable with simple object
}
```

### Skin and Wrap the API

**When**: Third-party API is hard to mock.

```typescript
// Before - direct AWS SDK usage everywhere
async function uploadFile(file: Buffer) {
  const s3 = new S3Client({});
  await s3.send(
    new PutObjectCommand({
      Bucket: "my-bucket",
      Key: "file.txt",
      Body: file,
    }),
  );
}

// After - wrap in your own interface
interface FileStorage {
  upload(key: string, content: Buffer): Promise<void>;
}

class S3Storage implements FileStorage {
  private client = new S3Client({});

  async upload(key: string, content: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: "my-bucket",
        Key: key,
        Body: content,
      }),
    );
  }
}

class FakeStorage implements FileStorage {
  files: Map<string, Buffer> = new Map();

  async upload(key: string, content: Buffer): Promise<void> {
    this.files.set(key, content);
  }
}
```

## Database Adapter Pattern

### Seam Type

**Interface extraction + Factory function**

This is a combination technique: extract a common interface for database operations, then use a factory function as the enabling point to choose which implementation to use.

### The Problem

Database-dependent code creates testing challenges:

- **Slow Tests**: Real database I/O is 10x slower than in-memory operations
- **Shared State**: Tests pollute each other's state when using shared database
- **Flaky Tests**: Race conditions and timing issues with real databases
- **Setup Complexity**: Tests need migrations, seed data, cleanup

### Before (Tightly Coupled)

```typescript
// Direct database usage - hard to test
async function sendMessage(msg: Message) {
  const db = getDatabase(); // Singleton - can't swap implementation
  await db.query('INSERT INTO messages (subject, body) VALUES ($1, $2)', [msg.subject, msg.body]);
}

// Tests must use real database
test('sends message', async () => {
  // Slow: real PGLite instance
  // Shared: other tests see this data
  await sendMessage({ subject: 'Test', body: 'Body' });
});
```

### After (Decoupled)

```typescript
// Step 1: Define interface (seam)
interface DatabaseAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

// Step 2: Production implementation
class PGliteDatabaseAdapter implements DatabaseAdapter {
  constructor(private db: PGlite) {}
  
  async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const result = await this.db.query<T>(sql, params);
    return { rows: result.rows, affectedRows: result.affectedRows };
  }
  
  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }
  
  async close(): Promise<void> {
    await this.db.close();
  }
}

// Step 3: Test implementation (fake)
class InMemoryDatabaseAdapter implements DatabaseAdapter {
  private tables = new Map<string, Array<Record<string, any>>>();
  
  async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    // Simple in-memory simulation
    // No SQL parser needed - pattern match common queries
    if (sql.includes('INSERT INTO messages')) {
      const messages = this.tables.get('messages') || [];
      messages.push({ subject: params[0], body: params[1] });
      this.tables.set('messages', messages);
      return { rows: [] as T[] };
    }
    
    if (sql.includes('SELECT * FROM messages')) {
      const messages = this.tables.get('messages') || [];
      return { rows: messages as T[] };
    }
    
    return { rows: [] as T[] };
  }
  
  async exec(sql: string): Promise<void> {
    // Handle CREATE TABLE, CREATE INDEX, etc.
    if (sql.includes('CREATE TABLE')) {
      const match = sql.match(/CREATE TABLE (\w+)/i);
      if (match) {
        this.tables.set(match[1], []);
      }
    }
  }
  
  async close(): Promise<void> {
    this.tables.clear();
  }
}

// Step 4: Factory function (enabling point)
async function createSwarmMailAdapter(options: {
  projectPath?: string;
  inMemory?: boolean;
  dbOverride?: DatabaseAdapter;
}) {
  let db: DatabaseAdapter;
  
  if (options.dbOverride) {
    db = options.dbOverride;
  } else if (options.inMemory) {
    db = new InMemoryDatabaseAdapter();
  } else {
    const pglite = await getDatabase(options.projectPath);
    db = new PGliteDatabaseAdapter(pglite);
  }
  
  return { db, /* ... other adapter methods */ };
}

// Step 5: Accept adapter as optional parameter (backwards compatible)
async function sendMessage(msg: Message, adapter?: SwarmMailAdapter) {
  const db = adapter?.db ?? (await createSwarmMailAdapter()).db;
  await db.query(
    'INSERT INTO messages (subject, body) VALUES ($1, $2)',
    [msg.subject, msg.body]
  );
}
```

### Test Setup

```typescript
import { createInMemorySwarmMail } from './streams/test-utils';

describe('Message Sending', () => {
  let adapter: SwarmMailAdapter;
  let cleanup: () => Promise<void>;
  
  beforeEach(async () => {
    // Fast: in-memory adapter, no disk I/O
    // Isolated: each test gets its own instance
    const result = await createInMemorySwarmMail();
    adapter = result.adapter;
    cleanup = result.cleanup;
  });
  
  afterEach(async () => {
    await cleanup();
  });
  
  it('sends message successfully', async () => {
    // 10x faster than PGLite
    // No shared state with other tests
    await sendMessage({ subject: 'Test', body: 'Body' }, adapter);
    
    const messages = await adapter.db.query('SELECT * FROM messages');
    expect(messages.rows).toHaveLength(1);
  });
});
```

### Benefits

1. **Speed**: In-memory tests run 10x faster than PGLite
2. **Isolation**: Each test gets its own adapter instance - no shared state
3. **Parallelization**: Tests can run in parallel safely
4. **Simplicity**: No database migrations or cleanup needed in tests
5. **Flexibility**: Easy to swap implementations (production, test, mock)

### When to Use

- **Unit Tests**: Always use in-memory adapter for speed and isolation
- **Integration Tests**: Use real database adapter to verify SQL correctness
- **Database-Dependent Code**: Any code that queries or mutates database
- **Performance-Critical Tests**: When test suite takes too long
- **CI/CD Pipelines**: Faster builds with in-memory tests

### Trade-offs

**Limitations of In-Memory Adapter**:

- No SQL parsing (uses regex pattern matching)
- Limited query support (no JOINs, subqueries, CTEs)
- May not catch database-specific bugs (constraints, triggers)
- Behavior may differ slightly from real database

**Solution**: Use both adapters appropriately:

```typescript
// Fast unit tests: in-memory
describe('Business Logic', () => {
  const adapter = await createSwarmMailAdapter({ inMemory: true });
  // ...
});

// Slower integration tests: real database
describe('SQL Queries', () => {
  const adapter = await createSwarmMailAdapter({ projectPath: './test-db' });
  // ...
});
```

### Real-World Example

From `src/adapter.test.ts`:

```typescript
describe("InMemoryDatabaseAdapter", () => {
  let db: DatabaseAdapter;

  beforeEach(() => {
    db = new InMemoryDatabaseAdapter();
  });

  afterEach(async () => {
    await db.close();
  });

  it("should handle transactions", async () => {
    await db.exec("CREATE TABLE accounts (id SERIAL, balance INTEGER)");
    await db.query("INSERT INTO accounts (balance) VALUES ($1)", [100]);
    
    // BEGIN transaction
    await db.exec("BEGIN");
    await db.query("UPDATE accounts SET balance = $1 WHERE id = $2", [150, 1]);
    
    // ROLLBACK - should restore original state
    await db.exec("ROLLBACK");
    
    const result = await db.query<{ balance: number }>(
      "SELECT balance FROM accounts WHERE id = 1"
    );
    
    expect(result.rows[0].balance).toBe(100); // Original value preserved
  });
  
  it("should auto-increment SERIAL columns", async () => {
    await db.exec("CREATE TABLE events (id SERIAL PRIMARY KEY, type TEXT)");
    
    await db.query("INSERT INTO events (type) VALUES ($1)", ["event1"]);
    await db.query("INSERT INTO events (type) VALUES ($1)", ["event2"]);
    
    const result = await db.query<{ id: number; type: string }>(
      "SELECT id, type FROM events"
    );
    
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].id).toBe(1);
    expect(result.rows[1].id).toBe(2);
  });
});
```

### See Also

- `src/adapter.ts` - Full implementation with both adapters
- `src/streams/test-utils.ts` - `createInMemorySwarmMail()` helper
- `src/types/database.ts` - `DatabaseAdapter` interface definition
- Extract Interface (above) - Core technique for creating the seam
- Skin and Wrap the API (above) - Similar pattern for external APIs

## Quick Reference

| Problem                         | Technique                           |
| ------------------------------- | ----------------------------------- |
| Constructor creates dependency  | Parameterize Constructor            |
| Constructor does complex work   | Extract and Override Factory Method |
| Can't change constructor        | Supersede Instance Variable         |
| Method makes problematic call   | Extract and Override Call           |
| Method uses hardcoded value     | Parameterize Method                 |
| Need test double for class      | Extract Interface                   |
| Static methods block testing    | Introduce Instance Delegator        |
| Long method, many locals        | Break Out Method Object             |
| Method doesn't use instance     | Expose Static Method                |
| Singleton blocks testing        | Introduce Static Setter             |
| Global variable usage           | Encapsulate Global References       |
| Need to sense/neutralize method | Subclass and Override Method        |
| Few methods have dependencies   | Push Down Dependency                |
| Parameter hard to construct     | Adapt Parameter                     |
| Third-party API hard to mock    | Skin and Wrap the API               |
