type Constructor = new (...args: any[]) => any;
export interface DocsConfig {
    /** Class-level decorators (e.g. ApiTags). Applied to the constructor. */
    classDecorators?: ClassDecorator[];
    /** Method-level decorators keyed by method name. */
    methods?: Record<string, MethodDecorator[]>;
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
export declare function docs(controllerClass: Constructor, config: DocsConfig): void;
export {};
