import {Component, ElementRef, HostListener, OnInit, Renderer2, ViewChild} from '@angular/core';
import {atan2, cos, pi, sin, unit} from 'mathjs';
import {OverlayService} from "./overlay.service";
import {SERVER_ROUTE} from "../assets/route";
import {
    CircleCoordinates,
    GameFieldSize,
    LineCoordinates,
    ScoreTableEntity,
    ServerMessage,
    ServerMessageType
} from "./models";
import {ValidatorService} from "./validator.service";


@Component({
    selector: 'app',
    templateUrl: "app.component.html"
})
export class AppComponent implements OnInit {

    public cannonWidth = 0;
    public cannonballWidth = 0;

    public gameFieldSize: GameFieldSize = {
        width: 600,
        height: 300
    }

    public groundCoordinates: LineCoordinates = {
        x1: 50,
        y1: 250,
        x2: 550,
        y2: 250
    };

    public vectorCoordinates: LineCoordinates = {
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0
    };

    public cannonballCoordinates: CircleCoordinates = {
        x: 0,
        y: 0
    };

    public playersCoordinates: {
        [playerId: string]: number
    };

    public isPendingShot: boolean = false;

    public selfId: string;

    public opponentId: string;

    public playerNickname: string;

    public statistics: ScoreTableEntity[];

    private shootingPlayerId: string;

    private isCannonballFlying: boolean = false;

    /**
     * start speed (relative, doesn't affect real rendered cannonball speed)
     */
    private v0: number;

    /**
     * gravity constant
     */
    private g: number;

    private webSocketConnection: WebSocket;

    @ViewChild("gameField")
    private gameField: ElementRef;

    @ViewChild("cannonball")
    private cannonball: ElementRef;

    constructor(private renderer: Renderer2,
                private overlayService: OverlayService,
                private validatorService: ValidatorService) {
    }

    public ngOnInit() {
        this.playerNickname = prompt("Enter your nickname");
        if (this.playerNickname) {
            this.connectToServer();
        } else {
            alert("Connection denied. Reload the page and try to enter your name one more time");
        }
    }

    @HostListener("mousemove", ["$event.target", "$event.pageX", "$event.pageY"])
    private calculateVectorCoordinates(target, pageX, pageY) {
        if (this.isPendingShot && this.gameField.nativeElement === target) {
            const gameFieldRect: DOMRect = target.getBoundingClientRect();
            this.vectorCoordinates = {
                x1: this.playersCoordinates[this.shootingPlayerId],
                y1: this.groundCoordinates.y1,
                x2: pageX - gameFieldRect.x,
                y2: pageY - gameFieldRect.y
            }
        } else {
            this.resetVectorCoordinates();
        }
    }

    @HostListener("click", ["$event.target"])
    private shoot(target) {
        if (this.isPendingShot && this.gameField.nativeElement === target && !this.isCannonballFlying) {
            this.isPendingShot = false;
            const yRange = this.groundCoordinates.y2 - this.vectorCoordinates.y2;
            const xRange = this.vectorCoordinates.x2 - this.playersCoordinates[this.shootingPlayerId];
            const angle = atan2(yRange, xRange) * 180 / pi;
            this.animateCannonball(angle);
            this.sendShotInfo(angle);
        }
    }

    private connectToServer() {
        this.webSocketConnection = new WebSocket(SERVER_ROUTE);

        this.webSocketConnection.onopen = () => {
            console.log("the connection is opened");
            this.sendPlayerNickname();
            this.overlayService.setOverlay("Awaiting for another player");
        }

        this.webSocketConnection.onclose = () => {
            this.overlayService.setOverlay("The server is not available", "rgba(246, 99, 99, 0.4)")
            console.log("the connection is closed");
        }

        this.webSocketConnection.onmessage = this.onMessageFromServer.bind(this);
    }

    private resetVectorCoordinates(): void {
        this.vectorCoordinates = {
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 0
        };
    }

    /**
     * @param angle: in degrees
     */
    private animateCannonball(angle: number) {

        this.startFlightAnimation();

        let t = 0;
        const deltaT = 0.1;
        const rerenderTimeout = 10;

        const {x, y} = this.generateFlightFunctions(angle);
        this.cannonballCoordinates = {
            x: x(t),
            y: y(t)
        };

        const flight = setInterval(() => {
            if (this.cannonballCoordinates.y <= this.findGroundYCoordinate(this.cannonballCoordinates.x)) {
                this.cannonballCoordinates = {
                    x: x(t),
                    y: y(t)
                };
                t += deltaT;
            } else {
                this.finishFlightAnimation();
                clearInterval(flight);
            }
        }, rerenderTimeout)
    }

    /**
     * @param angle: in degrees
     */
    private generateFlightFunctions(angle: number): { x: Function, y: Function } {

        const x0 = this.playersCoordinates[this.shootingPlayerId];
        const y0 = this.findGroundYCoordinate(x0);
        const v0x = this.v0 * cos(unit(angle, "deg"));
        const v0y = this.v0 * sin(unit(angle, "deg"));

        return {
            x: (t) => x0 + (v0x * t),
            y: (t) => y0 - (v0y * t) + (this.g * t ** 2) / 2
        }
    }

    /**
     * this method is needed for an ability to improve gameplay and create not flat ground or ground with an angle
     * now the method returns just y1 because of flat ground
     */
    private findGroundYCoordinate(x: number): number {
        return this.groundCoordinates.y1;
    }

    private startFlightAnimation(): void {
        this.isCannonballFlying = true;
        this.renderer.setStyle(this.cannonball.nativeElement, "display", "block");
    }

    private finishFlightAnimation(): void {
        this.renderer.setStyle(this.cannonball.nativeElement, "display", "none");
        this.isCannonballFlying = false;
        this.cannonballCoordinates = {
            x: 0,
            y: 0
        }
    }

    private sendShotInfo(angle: number) {
        this.webSocketConnection.send(JSON.stringify({angle}));
    }

    private sendPlayerNickname() {
        this.webSocketConnection.send(JSON.stringify({nickname: this.playerNickname}));
    }

    private onMessageFromServer(messageEvent: MessageEvent) {
        const message: ServerMessage = JSON.parse(messageEvent.data);
        console.log(`a message from the server:`, message);

        if (!this.validatorService.isServerMessageValid(message)) {
            throw new Error("Invalid message from server!" + messageEvent.data);
        }

        switch (message.type) {
            case ServerMessageType.IdNotification: {
                this.selfId = message.data.id;
                console.log("My id is", this.selfId);
                break;
            }
            case ServerMessageType.RoundStarted: {
                this.startRound(message.data);
                break;
            }
            case ServerMessageType.Awaiting: {
                this.overlayService.setOverlay("Awaiting for another player");
                break;
            }
            case ServerMessageType.OpponentShot: {
                this.animateCannonball(message.data.angle);
                break;
            }
            case ServerMessageType.HaveKilled: {
                this.showGameplayInfo(
                    "Nice shot!",
                    "rgba(164, 238, 119, 0.4)",
                    message.data.doubleTimeout / 2,
                    message.data.doubleTimeout / 2
                );
                break;
            }
            case ServerMessageType.SlipUp: {
                this.showGameplayInfo(
                    "Slip-up!",
                    "rgba(246, 99, 99, 0.4)",
                    message.data.doubleTimeout / 2,
                    message.data.doubleTimeout / 2
                );
                break;
            }
            case ServerMessageType.IsKilled: {
                this.showGameplayInfo(
                    "Killed!",
                    "rgba(246, 99, 99, 0.4)",
                    message.data.doubleTimeout / 2,
                    message.data.doubleTimeout / 2
                );
                break;
            }
            case ServerMessageType.IsNotKilled: {
                this.showGameplayInfo(
                    "You're lucky!",
                    "rgba(246, 204, 99, 0.4)",
                    message.data.doubleTimeout / 2,
                    message.data.doubleTimeout / 2
                );
                break;
            }
            case ServerMessageType.Statistics: {
                this.statistics = message.data;
            }
        }
    }

    private startRound(data): void {
        this.shootingPlayerId = data.shootingPlayerId;
        this.playersCoordinates = data.playersCoordinates;
        this.gameFieldSize = data.gameFieldSize;
        this.groundCoordinates = data.groundCoordinates;
        this.cannonWidth = data.cannonWidth;
        this.cannonballWidth = data.cannonballWidth;
        this.v0 = data.v0;
        this.g = data.g;
        this.resetVectorCoordinates();
        this.isPendingShot = this.shootingPlayerId === this.selfId;
        this.opponentId = Object.keys(this.playersCoordinates).find(id => id !== this.selfId);
        this.overlayService.resetOverlay();
    }

    private showGameplayInfo(message: string, background: string, timeoutBeforeShowing: number, showingTimeout: number): void {
        new Promise(() => {
            setTimeout(() => {
                this.overlayService.setOverlay(message, background)
            }, timeoutBeforeShowing)
        }).then(() => {
            setTimeout(() => {
                this.overlayService.resetOverlay();
            }, showingTimeout);
        });
    }
}
