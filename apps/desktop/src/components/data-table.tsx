import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import {
  type ColumnDef,
  type SortDirection,
  type SortingState,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpDownLine,
  RiArrowUpSLine,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type SortValue = string | number | boolean | null | undefined

type DataTableColumn<R> = {
  key: string
  label: ReactNode
  align?: 'start' | 'end'
  mono?: boolean
  width?: number | string
  sortable?: boolean
  render?: (row: R) => ReactNode
  sortValue?: (row: R) => SortValue
}

type DataTableSort = { key: string; dir: 'asc' | 'desc' }

type DataTablePagination = {
  pageIndex: number
  pageSize: number
  rowCount: number
  onPageChange: (pageIndex: number) => void
}

type DataTableProps<R> = {
  columns: DataTableColumn<R>[]
  rows: R[]
  getRowId?: (row: R, index: number) => string
  onRowClick?: (row: R) => void
  selectedKey?: string | number | null
  defaultSort?: DataTableSort
  density?: 'compact' | 'comfortable'
  caption?: ReactNode
  pageSize?: number
  pagination?: DataTablePagination
  loading?: boolean
  empty?: ReactNode
  className?: string
}

const SKELETON_ROWS = 5
const SKELETON_WIDTHS = ['w-24', 'w-14', 'w-20', 'w-10', 'w-16']
const NESTED_CONTROLS = 'a, button, input, select, textarea, [role="switch"], [role="checkbox"]'

function readField<R>(row: R, key: string): unknown {
  return (row as Record<string, unknown>)[key]
}

function defaultRowId<R>(row: R, index: number) {
  const id = readField(row, 'id')
  return id == null ? String(index) : String(id)
}

function isBlank(node: ReactNode) {
  return node == null || node === false || node === ''
}

function DataTable<R>({
  columns,
  rows,
  getRowId = defaultRowId,
  onRowClick,
  selectedKey,
  defaultSort,
  density = 'compact',
  caption,
  pageSize,
  pagination,
  loading = false,
  empty,
  className,
}: DataTableProps<R>) {
  const serverPaged = pagination != null
  const clientPaged = !serverPaged && pageSize != null
  const [sorting, setSorting] = useState<SortingState>(() =>
    defaultSort ? [{ id: defaultSort.key, desc: defaultSort.dir === 'desc' }] : []
  )

  const columnsByKey = useMemo(() => new Map(columns.map(c => [c.key, c])), [columns])
  const columnDefs = useMemo<ColumnDef<R, SortValue>[]>(
    () =>
      columns.map(column => ({
        id: column.key,
        accessorFn: row =>
          (column.sortValue ? column.sortValue(row) : (readField(row, column.key) as SortValue)) ??
          undefined,
        enableSorting: column.sortable !== false,
        sortUndefined: 'last',
      })),
    [columns]
  )

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    getRowId,
    state: { sorting },
    onSortingChange: setSorting,
    enableSorting: !serverPaged,
    enableSortingRemoval: false,
    sortDescFirst: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(clientPaged && {
      getPaginationRowModel: getPaginationRowModel(),
      initialState: { pagination: { pageIndex: 0, pageSize } },
    }),
  })

  const frameClass = cn('bg-card min-w-0 overflow-hidden rounded-sm border', className)

  if (!loading && rows.length === 0 && empty) {
    return (
      <div data-slot="data-table" className={frameClass}>
        <div data-slot="data-table-empty" className="p-4">
          {empty}
        </div>
      </div>
    )
  }

  const handleRowClick = (event: MouseEvent<HTMLTableRowElement>, row: R) => {
    const control = (event.target as Element).closest(NESTED_CONTROLS)
    if (control && control !== event.currentTarget && event.currentTarget.contains(control)) return
    onRowClick?.(row)
  }

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: R) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onRowClick?.(row)
    }
  }

  const pager = serverPaged
    ? {
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        total: pagination.rowCount,
        pageCount: Math.ceil(pagination.rowCount / pagination.pageSize),
        goTo: pagination.onPageChange,
      }
    : clientPaged
      ? {
          pageIndex: table.getState().pagination.pageIndex,
          pageSize: table.getState().pagination.pageSize,
          total: table.getPrePaginationRowModel().rows.length,
          pageCount: table.getPageCount(),
          goTo: (index: number) => table.setPageIndex(index),
        }
      : null

  const rowHeight = density === 'comfortable' ? 'h-10' : 'h-9'

  return (
    <div data-slot="data-table" className={frameClass}>
      <Table aria-busy={loading || undefined} className="text-ui">
        {caption && (
          <TableCaption className="text-ui text-foreground mt-0 caption-top border-b px-3 py-2.5 text-left font-semibold">
            {caption}
          </TableCaption>
        )}
        <TableHeader>
          {table.getHeaderGroups().map(group => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map(header => {
                const column = columnsByKey.get(header.column.id)!
                const sorted = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    scope="col"
                    aria-sort={
                      sorted ? (sorted === 'desc' ? 'descending' : 'ascending') : undefined
                    }
                    style={column.width != null ? { width: column.width } : undefined}
                    className={cn(
                      'text-label text-muted-foreground h-8 px-3 font-[560] font-stretch-[92%]',
                      column.align === 'end' && 'text-right'
                    )}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 rounded-[2px]"
                      >
                        {column.label}
                        <SortIcon sorted={sorted} />
                      </button>
                    ) : (
                      column.label
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <TableRow key={i} className={cn(rowHeight, 'hover:bg-transparent')}>
                  {columns.map((column, j) => (
                    <TableCell key={column.key} className="px-3 py-1.5">
                      <Skeleton
                        className={cn(
                          'h-3.5',
                          SKELETON_WIDTHS[(i + j) % SKELETON_WIDTHS.length],
                          column.align === 'end' && 'ml-auto'
                        )}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : table.getRowModel().rows.map(row => {
                const selected = selectedKey != null && String(selectedKey) === row.id
                return (
                  <TableRow
                    key={row.id}
                    data-state={selected ? 'selected' : undefined}
                    aria-current={selected ? 'true' : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? event => handleRowClick(event, row.original) : undefined}
                    onKeyDown={
                      onRowClick ? event => handleRowKeyDown(event, row.original) : undefined
                    }
                    className={cn(
                      rowHeight,
                      onRowClick && 'cursor-pointer',
                      'focus-visible:-outline-offset-2'
                    )}
                  >
                    {row.getVisibleCells().map(cell => {
                      const column = columnsByKey.get(cell.column.id)!
                      const content = column.render
                        ? column.render(row.original)
                        : (readField(row.original, column.key) as ReactNode)
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            'px-3 py-1.5',
                            column.align === 'end' && 'text-right',
                            column.mono && 'text-data font-mono tabular-nums'
                          )}
                        >
                          {isBlank(content) ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            content
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })}
        </TableBody>
      </Table>
      {!loading && pager && pager.pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
          <span className="text-label text-muted-foreground font-normal tabular-nums">
            {m.table_page_info({
              start: formatNumber(pager.pageIndex * pager.pageSize + 1),
              end: formatNumber(Math.min((pager.pageIndex + 1) * pager.pageSize, pager.total)),
              total: formatNumber(pager.total),
            })}
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              disabled={pager.pageIndex <= 0}
              onClick={() => pager.goTo(pager.pageIndex - 1)}
            >
              <RiArrowLeftSLine data-icon="inline-start" />
              {m.table_prev()}
            </Button>
            <Button
              size="sm"
              disabled={pager.pageIndex >= pager.pageCount - 1}
              onClick={() => pager.goTo(pager.pageIndex + 1)}
            >
              {m.table_next()}
              <RiArrowRightSLine data-icon="inline-end" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function SortIcon({ sorted }: { sorted: false | SortDirection }) {
  if (sorted === 'asc') return <RiArrowUpSLine aria-hidden className="text-foreground size-3" />
  if (sorted === 'desc') return <RiArrowDownSLine aria-hidden className="text-foreground size-3" />
  return <RiArrowUpDownLine aria-hidden className="text-ink-subtle size-3" />
}

export {
  DataTable,
  type DataTableColumn,
  type DataTablePagination,
  type DataTableProps,
  type DataTableSort,
}
