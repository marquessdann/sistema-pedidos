export const ORDER_STATUSES = [
  'DRAFT',
  'CREATED',
  'PENDING_APPROVAL',
  'APPROVED',
  'AWAITING_PICKING',
  'LOGISTICS_RECEIVED',
  'PICKING',
  'AWAITING_SHIPMENT',
  'INVOICED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Rascunho',
  CREATED: 'Pedido criado',
  PENDING_APPROVAL: 'Aguardando aprovação comercial',
  APPROVED: 'Pedido aprovado',
  AWAITING_PICKING: 'Enviado para a logística',
  LOGISTICS_RECEIVED: 'Recebido na logística',
  PICKING: 'Em separação',
  AWAITING_SHIPMENT: 'Separado',
  INVOICED: 'Faturado',
  SHIPPED: 'Enviado',
  OUT_FOR_DELIVERY: 'Em rota de entrega',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  REJECTED: 'Reprovado',
};

/**
 * Ciclo do pedido:
 * vendedor → (Daniel/Vinicius) aprovado → faturado → enviado para a logística
 * → (logística) recebido → em separação → separado → em rota de entrega → entregue.
 */
export const ORDER_TIMELINE: OrderStatus[] = [
  'CREATED',
  'PENDING_APPROVAL',
  'APPROVED',
  'INVOICED',
  'AWAITING_PICKING',
  'LOGISTICS_RECEIVED',
  'PICKING',
  'AWAITING_SHIPMENT',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
];

export const ORDER_TERMINAL_STATUSES: OrderStatus[] = ['COMPLETED', 'CANCELLED', 'REJECTED'];

/** Status que contam como venda confirmada (não inclui rascunho, cancelado ou reprovado). */
export const ORDER_CONFIRMED_STATUSES: OrderStatus[] = [
  'CREATED',
  'PENDING_APPROVAL',
  'APPROVED',
  'INVOICED',
  'AWAITING_PICKING',
  'LOGISTICS_RECEIVED',
  'PICKING',
  'AWAITING_SHIPMENT',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
];

/** Status já faturados (o faturamento acontece antes de o pedido ir para a logística). */
export const ORDER_FULFILLED_STATUSES: OrderStatus[] = [
  'INVOICED',
  'AWAITING_PICKING',
  'LOGISTICS_RECEIVED',
  'PICKING',
  'AWAITING_SHIPMENT',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
];

/** Pedidos com a logística (para separar). */
export const ORDER_LOGISTICS_STATUSES: OrderStatus[] = ['AWAITING_PICKING', 'LOGISTICS_RECEIVED', 'PICKING', 'AWAITING_SHIPMENT'];

/** Status em que a mercadoria já saiu (baixa de estoque, quando o controle estiver ligado). */
export const ORDER_DISPATCHED_STATUSES: OrderStatus[] = ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'];

/** Transições padrão do ciclo (o administrador pode ajustar em Configurações). */
export const DEFAULT_ORDER_TRANSITIONS: [OrderStatus, OrderStatus][] = [
  ['CREATED', 'PENDING_APPROVAL'],
  ['CREATED', 'APPROVED'],
  ['CREATED', 'REJECTED'],
  ['CREATED', 'CANCELLED'],
  ['PENDING_APPROVAL', 'APPROVED'],
  ['PENDING_APPROVAL', 'REJECTED'],
  ['PENDING_APPROVAL', 'CANCELLED'],
  ['APPROVED', 'INVOICED'],
  ['APPROVED', 'CANCELLED'],
  ['INVOICED', 'AWAITING_PICKING'],
  ['INVOICED', 'CANCELLED'],
  ['AWAITING_PICKING', 'LOGISTICS_RECEIVED'],
  ['AWAITING_PICKING', 'CANCELLED'],
  ['LOGISTICS_RECEIVED', 'PICKING'],
  ['LOGISTICS_RECEIVED', 'CANCELLED'],
  ['PICKING', 'AWAITING_SHIPMENT'],
  ['PICKING', 'CANCELLED'],
  ['AWAITING_SHIPMENT', 'OUT_FOR_DELIVERY'],
  ['AWAITING_SHIPMENT', 'SHIPPED'],
  ['AWAITING_SHIPMENT', 'CANCELLED'],
  ['SHIPPED', 'OUT_FOR_DELIVERY'],
  ['SHIPPED', 'DELIVERED'],
  ['OUT_FOR_DELIVERY', 'DELIVERED'],
  ['DELIVERED', 'COMPLETED'],
];

export const QUOTE_STATUSES = [
  'DRAFT',
  'SENT',
  'AWAITING_RESPONSE',
  'APPROVED_BY_CLIENT',
  'REJECTED',
  'EXPIRED',
  'CONVERTED',
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado ao cliente',
  AWAITING_RESPONSE: 'Aguardando retorno',
  APPROVED_BY_CLIENT: 'Aprovado pelo cliente',
  REJECTED: 'Recusado',
  EXPIRED: 'Expirado',
  CONVERTED: 'Convertido em pedido',
};

/** Status de orçamento que ainda podem ser editados/convertidos (se dentro da validade). */
export const QUOTE_OPEN_STATUSES: QuoteStatus[] = ['DRAFT', 'SENT', 'AWAITING_RESPONSE', 'APPROVED_BY_CLIENT'];

/** Status que o vendedor pode definir manualmente em um orçamento. */
export const QUOTE_SELLER_SETTABLE: QuoteStatus[] = ['DRAFT', 'SENT', 'AWAITING_RESPONSE', 'APPROVED_BY_CLIENT', 'REJECTED'];

export const CLIENT_STATUSES = ['PENDING_REGISTRATION', 'UNDER_REVIEW', 'ACTIVE', 'BLOCKED', 'INACTIVE'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  PENDING_REGISTRATION: 'Aguardando cadastro',
  UNDER_REVIEW: 'Em análise',
  ACTIVE: 'Ativo',
  BLOCKED: 'Bloqueado',
  INACTIVE: 'Inativo',
};

export const APPROVAL_STATUS_LABELS = {
  NONE: 'Não necessária',
  PENDING: 'Aguardando aprovação',
  APPROVED: 'Aprovado',
  REJECTED: 'Reprovado',
} as const;
export type ApprovalStatus = keyof typeof APPROVAL_STATUS_LABELS;

export const STOCK_MOVEMENT_LABELS = {
  IN: 'Entrada',
  ADJUST: 'Ajuste',
  RESERVE: 'Reserva',
  RELEASE: 'Liberação de reserva',
  OUT: 'Baixa',
  RETURN: 'Devolução',
} as const;
export type StockMovementType = keyof typeof STOCK_MOVEMENT_LABELS;

export const STOCK_POLICY_LABELS = {
  ON_CONFIRM: 'Reservar quando o vendedor confirma o pedido, baixar no envio (recomendado)',
  ON_APPROVAL: 'Reservar na aprovação do pedido, baixar no envio',
  ON_PICKING: 'Reservar ao iniciar a separação, baixar no envio',
  ON_SHIPMENT: 'Baixar somente no envio (sem reserva)',
} as const;
export type StockPolicy = keyof typeof STOCK_POLICY_LABELS;

export const CONVERSION_PRICE_POLICY_LABELS = {
  KEEP_QUOTE_PRICES: 'Manter os preços aprovados no orçamento (com aviso de diferença)',
  USE_CURRENT_PRICES: 'Usar os preços atuais do catálogo (com aviso e confirmação)',
} as const;
export type ConversionPricePolicy = keyof typeof CONVERSION_PRICE_POLICY_LABELS;

/**
 * Etapas do andamento (chavinhas). "logistics" = etapas que a logística (Antonio) pode marcar;
 * administrador e gestor marcam todas. Cada etapa ligada implica as anteriores.
 */
export const ORDER_PROGRESS_STEPS = [
  { status: 'APPROVED', label: 'Aprovado', logistics: false },
  { status: 'INVOICED', label: 'Faturado', logistics: false },
  { status: 'AWAITING_PICKING', label: 'Enviado para a logística', logistics: false },
  { status: 'LOGISTICS_RECEIVED', label: 'Recebido na logística', logistics: true },
  { status: 'PICKING', label: 'Em separação', logistics: true },
  { status: 'AWAITING_SHIPMENT', label: 'Separado', logistics: true },
  { status: 'OUT_FOR_DELIVERY', label: 'Em rota de entrega', logistics: true },
  { status: 'DELIVERED', label: 'Entregue', logistics: true },
] as const satisfies readonly { status: OrderStatus; label: string; logistics: boolean }[];

export type OrderProgressStep = (typeof ORDER_PROGRESS_STEPS)[number]['status'];

/** Quantas etapas o pedido já cumpriu (0 a 8); -1 = rascunho, cancelado ou reprovado. */
export function orderProgressLevel(status: string): number {
  switch (status) {
    case 'APPROVED':
      return 1;
    case 'INVOICED':
      return 2;
    case 'AWAITING_PICKING':
      return 3;
    case 'LOGISTICS_RECEIVED':
      return 4;
    case 'PICKING':
      return 5;
    case 'AWAITING_SHIPMENT':
      return 6;
    case 'SHIPPED':
    case 'OUT_FOR_DELIVERY':
      return 7;
    case 'DELIVERED':
    case 'COMPLETED':
      return 8;
    case 'DRAFT':
    case 'CANCELLED':
    case 'REJECTED':
      return -1;
    default:
      return 0;
  }
}
