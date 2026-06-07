import { DynamicModule } from '@nestjs/common';
/**
 * Import once in your root AppModule — before any module that declares controllers
 * marked with @WithDocs().
 *
 * @example
 * @Module({
 *   imports: [DocfyModule.forRoot(), UsersModule],
 * })
 * export class AppModule {}
 */
export declare class DocfyModule {
    private static readonly logger;
    static forRoot(): DynamicModule;
    static loadAllDocs(requireFn?: (path: string) => void, cacheReader?: () => Record<string, {
        exports: Record<string, unknown>;
    } | undefined>): void;
}
