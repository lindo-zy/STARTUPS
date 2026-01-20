package router

import (
	"STARTUPS/internal/controller"
	"github.com/gin-gonic/gin"
	"net/http"
)

type APIRouter struct {
	roomController *controller.RoomController
	playController *controller.PlayController
}

func NewAPIRouter() *APIRouter {
	return &APIRouter{
		roomController: controller.NewRoomHandler(),
		playController: controller.NewPlayHandler(),
	}
}

func (c *APIRouter) RegisterRouter(r *gin.RouterGroup) {
	r.POST("/room/create", c.roomController.CreateRoom)
	r.POST("/room/join", c.roomController.JoinRoom)
	r.DELETE("/room/leave", c.roomController.LeaveRoom)
	r.GET("/room/status", c.roomController.Status)
	r.POST("/room/start", c.roomController.Start)
	r.POST("/room/ready", c.roomController.Ready)

	r.POST("/play/", nil)
	r.POST("/play/", nil)
	r.POST("/play/", nil)
	r.POST("/play/", nil)
}

func SetupRouter(r *gin.Engine) {
	//普通路由
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "hello world",
		})
	})
	//组织路由
	NewAPIRouter().RegisterRouter(r.Group("/api/"))

}
