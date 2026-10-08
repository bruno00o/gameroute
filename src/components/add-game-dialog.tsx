import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { open } from '@tauri-apps/plugin-dialog'
import { RiFolderOpenLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { addManualGame } from '@/lib/tauri'
import { errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { TextField } from '@/components/ui/text-field'

export function AddGameDialog({ children }: { children: React.ReactElement }) {
  const [open_, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const queryClient = useQueryClient()

  const handleBrowse = async () => {
    const selected = await open({
      title: m.games_add_browse(),
      multiple: false,
      filters: [
        {
          name: 'Executables',
          extensions: ['exe', 'app', 'sh', 'x86_64', 'x86', ''],
        },
      ],
    })
    if (selected) {
      setPath(selected)
      if (!name.trim()) {
        const filename = selected.split(/[/\\]/).pop() ?? ''
        const inferred = filename.replace(/\.(exe|app|sh|x86_64|x86)$/i, '')
        if (inferred) setName(inferred)
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !path.trim()) return

    setIsSubmitting(true)
    try {
      await addManualGame(name.trim(), path.trim())
      toast.success(m.games_added())
      queryClient.invalidateQueries({ queryKey: ['games'] })
      setOpen(false)
      setName('')
      setPath('')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open_} onOpenChange={setOpen}>
      <DialogTrigger render={children} />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{m.games_add_title()}</DialogTitle>
            <DialogDescription>{m.games_add_description()}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-3">
            <TextField
              id="game-name"
              label={m.games_add_name()}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={m.games_add_name_placeholder()}
              required
            />
            <div className="flex items-end gap-2">
              <TextField
                id="game-path"
                label={m.games_add_path()}
                value={path}
                onChange={e => setPath(e.target.value)}
                placeholder={m.games_add_path_placeholder()}
                required
                className="flex-1"
              />
              <Button
                type="button"
                size="icon"
                onClick={handleBrowse}
                title={m.games_add_browse()}
                aria-label={m.games_add_browse()}
              >
                <RiFolderOpenLine />
              </Button>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" onClick={() => setOpen(false)}>
              {m.games_add_cancel()}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
              disabled={!name.trim() || !path.trim()}
            >
              {m.games_add_submit()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
