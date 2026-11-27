// Runtime validation coverage for authenticated multipart image uploads.
// @vitest-environment jsdom
import type { AxiosProgressEvent, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, getErrorMessage, TOKEN_KEY } from './api'
import { uploadPropertyImages } from './properties'

const uploadedUrl = 'https://res.cloudinary.com/demo/image/upload/smartestate/properties/seller/image.jpg'
const originalAdapter = api.defaults.adapter

describe('uploadPropertyImages', () => {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => ({
    data: { images: [{ secureUrl: uploadedUrl }] },
    status: 201,
    statusText: 'Created',
    headers: {},
    config,
  }))

  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, 'seller-test-token')
    api.defaults.adapter = adapter
    adapter.mockClear()
  })

  afterEach(() => {
    localStorage.removeItem(TOKEN_KEY)
    api.defaults.adapter = originalAdapter
  })

  it('posts all files under Multer’s images field with seller auth and reports progress', async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'front.jpg', { type: 'image/jpeg' })
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'garden.png', { type: 'image/png' })
    const progress = vi.fn()

    await expect(uploadPropertyImages([jpeg, png], progress)).resolves.toEqual([uploadedUrl])

    const config = adapter.mock.calls[0]?.[0]
    expect(adapter).toHaveBeenCalledOnce()
    expect(config?.url).toBe('/properties/images')
    expect(config?.headers.get('Authorization')).toBe('Bearer seller-test-token')
    expect(config?.headers.getContentType()).not.toBe('application/json')
    expect(config?.data).toBeInstanceOf(FormData)
    expect((config?.data as FormData).getAll('images')).toEqual([jpeg, png])

    config?.onUploadProgress?.({ loaded: 50, total: 100, bytes: 50 } as AxiosProgressEvent)
    expect(progress).toHaveBeenCalledWith(50)
  })

  it('includes server validation details in the displayed error', () => {
    const error = Object.assign(new Error('Bad request'), {
      isAxiosError: true,
      response: {
        data: {
          message: 'Invalid property details',
          errors: { fieldErrors: { title: ['Too short'] }, formErrors: [] },
        },
      },
    })

    expect(getErrorMessage(error, 'Request failed')).toBe('Invalid property details: title: Too short')
  })
})
