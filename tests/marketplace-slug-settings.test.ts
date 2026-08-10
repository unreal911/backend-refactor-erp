import { describe, expect, it } from 'vitest';
import { UpdateOrderWorkflowSettingsDto } from '../src/domain/dtos/update-order-workflow-settings.dto';

describe('configuración de la dirección pública del marketplace', () => {
  it('normaliza el identificador antes de guardarlo', () => {
    const [error, dto] = UpdateOrderWorkflowSettingsDto.create({
      marketplaceSlug: '  Mi-Tienda  ',
    });

    expect(error).toBeUndefined();
    expect(dto?.marketplaceSlug).toBe('mi-tienda');
  });

  it.each(['api', 'admin', 'marketplace', '_next', 'www', 'mail', 'staging'])(
    'rechaza la ruta reservada %s',
    (marketplaceSlug) => {
      const [error, dto] = UpdateOrderWorkflowSettingsDto.create({ marketplaceSlug });

      expect(error).toMatch(/marketplaceSlug/i);
      expect(dto).toBeUndefined();
    },
  );

  it.each(['ab', 'mi tienda', '/fatima', 'fatima/', 'fatima--lima'])(
    'rechaza el formato ambiguo %s',
    (marketplaceSlug) => {
      const [error, dto] = UpdateOrderWorkflowSettingsDto.create({ marketplaceSlug });

      expect(error).toMatch(/marketplaceSlug/i);
      expect(dto).toBeUndefined();
    },
  );
});
