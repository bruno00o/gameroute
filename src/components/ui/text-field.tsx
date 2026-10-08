import { useId } from 'react'

import { cn } from '@/lib/utils'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'

type TextFieldProps = Omit<React.ComponentProps<'input'>, 'prefix'> & {
  label?: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  mono?: boolean
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  inputClassName?: string
}

function TextField({
  id,
  label,
  hint,
  error,
  mono = false,
  prefix,
  suffix,
  className,
  inputClassName,
  disabled,
  ...props
}: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = `${inputId}-message`
  const invalid = Boolean(error)
  const message = error || hint

  return (
    <Field
      data-slot="text-field"
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      className={className}
    >
      {label && <FieldLabel htmlFor={inputId}>{label}</FieldLabel>}
      <InputGroup>
        {prefix && <InputGroupAddon>{prefix}</InputGroupAddon>}
        <InputGroupInput
          id={inputId}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(mono && 'font-mono tabular-nums', inputClassName)}
          {...props}
        />
        {suffix && <InputGroupAddon align="inline-end">{suffix}</InputGroupAddon>}
      </InputGroup>
      {invalid ? (
        <FieldError id={messageId}>{error}</FieldError>
      ) : hint ? (
        <FieldDescription id={messageId}>{hint}</FieldDescription>
      ) : null}
    </Field>
  )
}

export { TextField, type TextFieldProps }
