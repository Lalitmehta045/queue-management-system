"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BulkGenerateTokenDto = void 0;
var class_validator_1 = require("class-validator");
var client_1 = require("@prisma/client");
var BulkGenerateTokenDto = /** @class */ (function () {
    function BulkGenerateTokenDto() {
    }
    __decorate([
        (0, class_validator_1.IsUUID)(),
        __metadata("design:type", String)
    ], BulkGenerateTokenDto.prototype, "serviceId", void 0);
    __decorate([
        (0, class_validator_1.IsInt)(),
        (0, class_validator_1.Min)(1),
        (0, class_validator_1.Max)(50),
        __metadata("design:type", Number)
    ], BulkGenerateTokenDto.prototype, "quantity", void 0);
    __decorate([
        (0, class_validator_1.IsEnum)(client_1.PriorityLevel),
        __metadata("design:type", String)
    ], BulkGenerateTokenDto.prototype, "priority", void 0);
    __decorate([
        (0, class_validator_1.IsOptional)(),
        (0, class_validator_1.IsUUID)(),
        __metadata("design:type", String)
    ], BulkGenerateTokenDto.prototype, "patientId", void 0);
    __decorate([
        (0, class_validator_1.IsOptional)(),
        (0, class_validator_1.IsEnum)(client_1.TokenType),
        __metadata("design:type", String)
    ], BulkGenerateTokenDto.prototype, "type", void 0);
    __decorate([
        (0, class_validator_1.ValidateIf)(function (o) { return o.specialCategory !== null && o.specialCategory !== undefined; }),
        (0, class_validator_1.IsEnum)(client_1.SpecialCategory),
        __metadata("design:type", String)
    ], BulkGenerateTokenDto.prototype, "specialCategory", void 0);
    return BulkGenerateTokenDto;
}());
exports.BulkGenerateTokenDto = BulkGenerateTokenDto;
