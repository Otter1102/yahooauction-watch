import { NextResponse } from 'next/server'
import { updateCondition, deleteCondition } from '@/lib/storage'

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json()
  await updateCondition(params.id, body)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await deleteCondition(params.id)
  return NextResponse.json({ ok: true })
}
