package response

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

type Response struct {
	Data    interface{} `json:"data"`
	Code    int         `json:"code"`
	Message string      `json:"message"`
}

func Success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Data:    data,
		Code:    http.StatusOK,
		Message: "success",
	})
}

func Fail(c *gin.Context, message string, code int) {
	c.JSON(http.StatusOK, Response{
		Data:    nil,
		Code:    code,
		Message: message,
	})
}
