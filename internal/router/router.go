package router

import (
	"STARTUPS/internal/controller"
	"github.com/gin-gonic/gin"
	"net/http"
)

type APIRouter struct {
	roomController *controller.RoomController
}

func NewAPIRouter(roomController *controller.RoomController) *APIRouter {
	return &APIRouter{
		roomController: roomController,
	}
}

func (c *APIRouter) RegisterRouter(r *gin.RouterGroup) {
	r.GET("/room", c.roomController.CreateRoom)
}

func SetupRouter(r *gin.Engine) {
	//普通路由
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "hello world",
		})
	})
	//组织路由
	NewAPIRouter(controller.NewRoomHandler()).RegisterRouter(r.Group("/"))

}
