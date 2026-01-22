package main

import (
	"STARTUPS/internal/middleware"
	"STARTUPS/internal/router"
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

func main() {
	//路由管理
	app := gin.New()
	//添加中间件
	app.Use(middleware.GlobalRecovery())
	//添加路由
	router.SetupRouter(app)
	srv := &http.Server{
		Addr:    ":8080",
		Handler: app,
	}
	// 3. 启动服务（goroutine）
	go func() {
		log.Println("Server starting on :8080")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	// 4. 等待中断信号（SIGINT 或 SIGTERM）
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutdown signal received, shutting down...")

	// 5. 优雅关闭（带超时）
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exited gracefully")
}
