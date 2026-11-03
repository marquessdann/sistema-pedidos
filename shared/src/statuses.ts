export const ORDER_STATUSES = [
  'DRAFT',
  'CREATED',
  'PENDING_APPROVAL',
  'APPROVED',
  'AWAITING_PICKING',
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
  AWAITING_PICKING: 'Aguardando separação',
  PICKING: 'Em separação',
  AWAITING_SHIPMENT: 'Aguardando expedição',
  INVOICED: 'Faturado',
  SHIPPED: 'Enviado',
  OUT_FOR_DELIVERY: 'Em rota de entrega',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  REJECTED: 'Reprovado',
};

/** Linha do tempo "feliz" exibida no acompanhamento do pedido. */
export const ORDER_TIMELINE: OrderStatus[] = [
  'CREATED',
  'PENDING_APPROVAL',
  'APPROVED',
  'AWAITING_PICKING',
  'PICKING',
  'AWAITING_SHIPMENT',
  'INVOICED',
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
  'AWAITING_PICKING',
  'PICKING',
  'AWAITING_SHIPMENT',
  'INVOICED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
];

/** Status considerados "faturados/realizados" (faturado, expedido, em rota ou entregue). */
export const ORDER_FULFILLED_STATUSES: OrderStatus[] = ['INVOICED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'];

/** Status em que a mercadoria já saiu (baixa de estoque, quando o controle estiver ligado). */
export const ORDER_DISPATCHED_STATUSES: OrderStatus[] = ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'];

/** Transições padrão (o administrador pode ajustar em Configurações). */
export const DEFAULT_ORDER_TRANSITIONS: [OrderStatus, OrderStatus][] = [
  ['CREATED', 'PENDING_APPROVAL'],
  ['CREATED', 'APPROVED'],
  ['CREATED', 'REJECTED'],
  ['CREATED', 'CANCELLED'],
  ['PENDING_APPROVAL', 'APPROVED'],
  ['PENDING_APPROVAL', 'REJECTED'],
  ['PENDING_APPROVAL', 'CANCELLED'],
  ['APPROVED', 'AWAITING_PICKING'],
  ['APPROVED', 'CANCELLED'],
  ['AWAITING_PICKING', 'PICKING'],
  ['AWAITING_PICKING', 'CANCELLED'],
  ['PICKING', 'AWAITING_SHIPMENT'],
  ['PICKING', 'CANCELLED'],
  ['AWAITING_SHIPMENT', 'SHIPPED'],
  ['AWAITING_SHIPMENT', 'INVOICED'],
  ['AWAITING_SHIPMENT', 'CANCELLED'],
  ['APPROVED', 'INVOICED'],
  ['PICKING', 'INVOICED'],
  ['INVOICED', 'SHIPPED'],
  ['INVOICED', 'OUT_FOR_DELIVERY'],
  ['INVOICED', 'DELIVERED'],
  ['INVOICED', 'CANCELLED'],
  ['SHIPPED', 'OUT_FOR_DELIVERY'],
  ['OUT_FOR_DELIVERY', 'DELIVERED'],
  ['SHIPPED', 'DELIVERED'],
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
