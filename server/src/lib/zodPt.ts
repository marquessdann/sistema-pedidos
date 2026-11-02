import { z } from 'zod';

/** Mensagens de validação em português. */
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'Campo obrigatório.' };
      return { message: 'Valor em formato inválido.' };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: issue.minimum === 1 ? 'Campo obrigatório.' : `Informe pelo menos ${issue.minimum} caracteres.` };
      if (issue.type === 'array') return { message: `Informe pelo menos ${issue.minimum} item(ns).` };
      return { message: `O valor mínimo é ${issue.minimum}.` };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Máximo de ${issue.maximum} caracteres.` };
      if (issue.type === 'array') return { message: `Máximo de ${issue.maximum} itens.` };
      return { message: `O valor máximo é ${issue.maximum}.` };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'E-mail inválido.' };
      if (issue.validation === 'uuid') return { message: 'Identificador inválido.' };
      return { message: 'Formato inválido.' };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Opção inválida.' };
    default:
      return { message: ctx.defaultError };
  }
});
