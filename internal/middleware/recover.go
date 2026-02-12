package middleware

import (
	"STARTUPS/internal/errors"
	"STARTUPS/internal/response"
	"github.com/gin-gonic/gin"
)

func GlobalRecovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				// 尝试 *AppError
				if appErr, ok := r.(*errors.AppError); ok {
					response.Fail(c, appErr.Message, appErr.Code)
					return
				}
				// 其他 panic
				response.Fail(c, errors.ErrInternal.Message, errors.ErrInternal.Code)
			}
		}()

		c.Next()
	}
}
