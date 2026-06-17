import { TagGroupRegistry } from './tag-group-registry';

type Constructor<T = any> = new (...args: any[]) => T;

export interface DocsConfig<T = any> {
  /** Class-level decorators (e.g. ApiTags). Applied to the constructor. */
  classDecorators?: ClassDecorator[];
  /** Method-level decorators keyed by method name. */
  methods?: Partial<Record<keyof T, MethodDecorator[]>>;
  /**
   * Logical group name for ReDoc's `x-tagGroups` extension. Purely
   * organizational — has no effect on per-operation Swagger tags.
   * Combine with `tags`, and call `attachTagGroups()` on the document
   * returned by `SwaggerModule.createDocument()`.
   */
  group?: string;
  /**
   * Tag names to associate with `group`. These should match the tags you
   * already apply via `ApiTags()` in `classDecorators` — nestjs-docfy does
   * not call `ApiTags` for you, it only builds the `x-tagGroups` mapping.
   */
  tags?: string[];
}

/**
 * Applies Swagger decorators to a controller class from outside the class file.
 * Mirrors exactly what TypeScript decorator syntax does: each decorator factory
 * is called with (prototype, methodName, descriptor) for methods, or (target)
 * for class-level decorators.
 *
 * Call this at the top level of a *.controller.docs.ts file:
 *
 * @example
 * docs(UsersController, {
 *   classDecorators: [ApiTags('users')],
 *   methods: {
 *     findAll: [ApiOperation({ summary: 'List all users' })],
 *   },
 * });
 */
export function docs<T>(controllerClass: Constructor<T>, config: DocsConfig<T>): void {
  if (config.classDecorators) {
    for (const decorator of config.classDecorators) {
      decorator(controllerClass);
    }
  }

  if (config.group) {
    TagGroupRegistry.register(config.group, config.tags ?? []);
  }

  if (!config.methods) return;

  for (const [methodName, decorators] of Object.entries(config.methods) as [string, MethodDecorator[]][]) {
    const descriptor = Object.getOwnPropertyDescriptor(
      controllerClass.prototype,
      methodName,
    );

    if (!descriptor) {
      console.warn(
        `[nestjs-docfy] Method "${methodName}" not found on ${controllerClass.name}. ` +
          `Check the spelling in your docs file.`,
      );
      continue;
    }

    for (const decorator of decorators) {
      decorator(controllerClass.prototype, methodName, descriptor);
    }
  }
}
